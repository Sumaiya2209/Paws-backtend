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
    origin: CLIENT_URL,
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

  



async function run() {
  await client.connect();
  const db = client.db("petPaws");
  const petsCollection = db.collection("pets");
  const requestsCollection = db.collection("requests");


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