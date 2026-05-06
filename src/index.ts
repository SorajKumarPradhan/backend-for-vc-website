// Importing required modules
import express from "express"; // Web framework for Node.js
import http from "http"; // Core Node.js HTTP module
import cors from "cors"; // Cross-Origin Resource Sharing (allows frontend to talk to backend)
import { Server, Socket } from "socket.io"; // Socket.io for real-time WebRTC signaling
import { PrismaClient } from "../generated/prisma/client.js"; // Prisma ORM for database interaction
// import bcrypt from "bcryptjs"; // Library to hash passwords securely
import jwt from "jsonwebtoken"; // Library to generate login tokens
import dotenv from "dotenv"; // Loads environment variables from .env file
import { PrismaPg } from "@prisma/adapter-pg";

dotenv.config(); // Initialize dotenv

const app = express(); // Create an Express application
const server = http.createServer(app); // Wrap Express in an HTTP server (needed for Socket.io)
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }, // Allow any frontend to connect via WebSockets
});

const connectionString = `${process.env.DATABASE_URL}`;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter }); // Initialize database client

app.use(cors()); // Enable CORS for HTTP routes
app.use(express.json()); // Tell Express to automatically parse JSON data sent in requests

const SECRET_KEY = process.env.JWT_SECRET || "supersecretkey"; // Key to sign login tokens

// --- AUTHENTICATION ROUTES ---

// SIGNUP ROUTE
app.post("/signup", async (req, res) => {
  const { name, email, password } = req.body; // Extract data from the request body
  try {
    const user = await prisma.user.create({
      data: { name, email, password },
    });
    res.status(201).json({ message: "User created successfully" }); // Send success response
  } catch (error) {
    res.status(400).json({ error: "Email already exists" }); // Handle duplicate email errors
  }
});

// LOGIN ROUTE
app.post("/signin", async (req, res) => {
  const { email, password } = req.body; // Extract login credentials
  const user = await prisma.user.findUnique({ where: { email } }); // Find user by email in DB

  if (!user) return res.status(404).json({ error: "User not found" }); // Error if user doesn't exist

  // Compare entered password with hashed DB password
  if (!(password === user.password))
    return res.status(401).json({ error: "Invalid password" }); // Error if passwords don't match

  const token = jwt.sign({ id: user.id }, SECRET_KEY, { expiresIn: "1h" }); // Create a secure token valid for 1 hour
  res.json({ token, name: user.name }); // Send token and user name back to frontend
});

io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`); // Log when a user connects

  // When a user wants to join a specific video call room
  socket.on("join-room", (roomId, userId) => {
    socket.join(roomId); // Socket.io puts this connection into a specific room channel
    socket.to(roomId).emit("user-connected", userId); // Tell everyone else in the room that a new user joined

    // When this user sends a WebRTC Offer (initiating call)
    socket.on("offer", (offer, toId) => {
      socket.to(roomId).emit("offer", offer, socket.id); // Forward offer to the target user
    });

    // When the target user replies with an Answer
    socket.on("answer", (answer, toId) => {
      socket.to(roomId).emit("answer", answer, socket.id); // Forward answer back to the initiator
    });

    // ICE candidates are network coordinates (IP/Port). Users must exchange these to connect.
    socket.on("ice-candidate", (candidate) => {
      socket.to(roomId).emit("ice-candidate", candidate, socket.id); // Forward network info to peers
    });

    // When the user disconnects (closes tab)
    socket.on("disconnect", () => {
      socket.to(roomId).emit("user-disconnected", userId); // Tell the room someone left
    });
  });
});

// Start the server on port 5000
server.listen(3000, "0.0.0.0", () =>
  console.log("Server is running on port 5000"),
);
