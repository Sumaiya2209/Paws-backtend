const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

dotenv.config();

const uri = process.env.MONGODB_URI;
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

const app = express();
app.use(
  cors({
    origin:[
       "http://localhost:3000",
       "https://paws-frontend-three.vercel.app"
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(new URL(`${CLIENT_URL}/api/auth/jwks`));

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const cookieToken = req.cookies?.token;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : cookieToken;

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = {
      id: payload.sub || payload.id,
      email: payload.email,
      name: payload.name || payload.email?.split("@")[0],
    };
    if (!req.user.email) {
      return res.status(403).json({ message: "Invalid token payload" });
    }
    next();
  } catch {
    return res.status(403).json({ message: "Forbidden" });
  }
};

async function run() {
  //await client.connect();
  const db = client.db("petPaws");
  const petsCollection = db.collection("pets");
  const requestsCollection = db.collection("requests");

  const count = await petsCollection.countDocuments();


  app.get("/", (req, res) => {
    res.send("Pet Adoption API is running");
  });

  app.get("/pets/featured", async (req, res) => {
    try {
      const result = await petsCollection
        .find({ status: "available" })
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/pets", async (req, res) => {
    try {
      const { name, species, sort } = req.query;
      const filter = { status: "available" };

      if (name) {
        filter.name = { $regex: name, $options: "i" };
      }

      if (species) {
        const list = species.split(",").map((s) => s.trim());
        filter.species = { $in: list };
      }

      let cursor = petsCollection.find(filter);

      if (sort === "fee-asc") {
        cursor = cursor.sort({ adoptionFee: 1 });
      } else if (sort === "fee-desc") {
        cursor = cursor.sort({ adoptionFee: -1 });
      } else if (sort === "name") {
        cursor = cursor.sort({ name: 1 });
      } else {
        cursor = cursor.sort({ createdAt: -1 });
      }

      const result = await cursor.toArray();
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/pets/owner/listings", verifyToken, async (req, res) => {
    try {
      const result = await petsCollection
        .find({ ownerEmail: req.user.email })
        .sort({ createdAt: -1 })
        .toArray();
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/pets/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid pet id" });
      }
      const pet = await petsCollection.findOne({ _id: new ObjectId(id) });
      if (!pet) return res.status(404).json({ message: "Pet not found" });
      res.json(pet);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/pets", verifyToken, async (req, res) => {
    try {
      const petData = {
        ...req.body,
        ownerEmail: req.user.email,
        status: "available",
        createdAt: new Date(),
      };
      const result = await petsCollection.insertOne(petData);
      res.status(201).json({ insertedId: result.insertedId });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/pets/:id", verifyToken, async (req, res) => {
    try {
      const { id } = req.params;
      const pet = await petsCollection.findOne({ _id: new ObjectId(id) });
      if (!pet) return res.status(404).json({ message: "Pet not found" });
      if (pet.ownerEmail !== req.user.email) {
        return res.status(403).json({ message: "Not authorized" });
      }
      const { ownerEmail, status, ...updates } = req.body;
      await petsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updates }
      );
      res.json({ message: "Pet updated" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/pets/:id", verifyToken, async (req, res) => {
    try {
      const { id } = req.params;
      const pet = await petsCollection.findOne({ _id: new ObjectId(id) });
      if (!pet) return res.status(404).json({ message: "Pet not found" });
      if (pet.ownerEmail !== req.user.email) {
        return res.status(403).json({ message: "Not authorized" });
      }
      await petsCollection.deleteOne({ _id: new ObjectId(id) });
      await requestsCollection.deleteMany({ petId: id });
      res.json({ message: "Pet deleted" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/requests", verifyToken, async (req, res) => {
    try {
      const { petId, pickupDate, message } = req.body;
      const pet = await petsCollection.findOne({ _id: new ObjectId(petId) });
      if (!pet) return res.status(404).json({ message: "Pet not found" });
      if (pet.ownerEmail === req.user.email) {
        return res
          .status(400)
          .json({ message: "You cannot adopt your own pet" });
      }
      if (pet.status === "adopted") {
        return res.status(400).json({ message: "Pet is already adopted" });
      }

      const existing = await requestsCollection.findOne({
        petId,
        userEmail: req.user.email,
        status: { $in: ["pending", "approved"] },
      });
      if (existing) {
        return res
          .status(400)
          .json({ message: "You already have a request for this pet" });
      }

      const requestDoc = {
        petId,
        petName: pet.name,
        userName: req.user.name,
        userEmail: req.user.email,
        pickupDate,
        message,
        status: "pending",
        createdAt: new Date(),
      };
      const result = await requestsCollection.insertOne(requestDoc);
      res.status(201).json({ insertedId: result.insertedId });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/requests/me", verifyToken, async (req, res) => {
    try {
      const result = await requestsCollection
        .find({ userEmail: req.user.email })
        .sort({ createdAt: -1 })
        .toArray();
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/requests/pet/:petId", verifyToken, async (req, res) => {
    try {
      const { petId } = req.params;
      const pet = await petsCollection.findOne({ _id: new ObjectId(petId) });
      if (!pet) return res.status(404).json({ message: "Pet not found" });
      if (pet.ownerEmail !== req.user.email) {
        return res.status(403).json({ message: "Not authorized" });
      }
      const result = await requestsCollection
        .find({ petId })
        .sort({ createdAt: -1 })
        .toArray();
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/requests/:id/approve", verifyToken, async (req, res) => {
    try {
      const { id } = req.params;
      const request = await requestsCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!request) return res.status(404).json({ message: "Request not found" });

      const pet = await petsCollection.findOne({
        _id: new ObjectId(request.petId),
      });
      if (!pet) return res.status(404).json({ message: "Pet not found" });
      if (pet.ownerEmail !== req.user.email) {
        return res.status(403).json({ message: "Not authorized" });
      }
      if (pet.status === "adopted") {
        return res.status(400).json({ message: "Pet already adopted" });
      }

      await requestsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "approved" } }
      );
      await requestsCollection.updateMany(
        {
          petId: request.petId,
          _id: { $ne: new ObjectId(id) },
          status: "pending",
        },
        { $set: { status: "rejected" } }
      );
      await petsCollection.updateOne(
        { _id: new ObjectId(request.petId) },
        { $set: { status: "adopted" } }
      );

      res.json({ message: "Request approved" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/requests/:id/reject", verifyToken, async (req, res) => {
    try {
      const { id } = req.params;
      const request = await requestsCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!request) return res.status(404).json({ message: "Request not found" });

      const pet = await petsCollection.findOne({
        _id: new ObjectId(request.petId),
      });
      if (!pet || pet.ownerEmail !== req.user.email) {
        return res.status(403).json({ message: "Not authorized" });
      }

      await requestsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "rejected" } }
      );
      res.json({ message: "Request rejected" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/requests/:id", verifyToken, async (req, res) => {
    try {
      const { id } = req.params;
      const request = await requestsCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!request) return res.status(404).json({ message: "Request not found" });
      if (request.userEmail !== req.user.email) {
        return res.status(403).json({ message: "Not authorized" });
      }
      await requestsCollection.deleteOne({ _id: new ObjectId(id) });
      res.json({ message: "Request cancelled" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  console.log("Connected to MongoDB");
}

run().catch(console.error);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
