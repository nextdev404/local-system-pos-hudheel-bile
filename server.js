const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// --- IN-MEMORY LIVE STATE ---
let tables = Array.from({ length: 6 }, (_, i) => ({
  id: `T${i + 1}`,
  name: "Available",
  status: "Available",
  bg: "bg-gray-100",
  text: "text-gray-400",
  cart: [],
  lockedBy: null,
  waiterName: null,
  openedAt: null,
  payRecords: [],
}));
let kitchenOrders = [];
let globalOrderHistory = [];
let globalStaff = []; // <--- NEW: Stores Staff for all devices
let globalProducts = []; // <--- NEW: Stores Products for all devices

// --- WEBSOCKETS (The Walkie-Talkie) ---
io.on("connection", (socket) => {
  const broadcastState = () => io.emit("sync_state", { tables, kitchenOrders });

  // Instantly send existing data to newly connected tablets
  socket.emit("sync_history", globalOrderHistory);
  if (globalStaff.length > 0) socket.emit("sync_staff", globalStaff);
  if (globalProducts.length > 0) socket.emit("sync_products", globalProducts);

  socket.on("update_table", (tableData) => {
    const index = tables.findIndex((t) => t.id === tableData.id);
    if (index !== -1) {
      tables[index] = tableData;
    } else {
      // FIX: Allow the server to save brand new tables added by the Admin!
      tables.push(tableData);
    }
  });

  socket.on("send_to_kitchen", (orderData) => {
    kitchenOrders.unshift(orderData);
    const table = tables.find((t) => t.id === orderData.tableId);
    if (table) table.status = "Sent to Kitchen";
    broadcastState();
    io.emit("toast", {
      msg: "New Order in Kitchen!",
      type: "info",
      roleTarget: "Chef",
    });
  });

  socket.on("update_kitchen_status", ({ orderId, nextStatus }) => {
    const kOrder = kitchenOrders.find((o) => o.id === orderId);
    if (!kOrder) return;
    kOrder.status = nextStatus;

    const table = tables.find((t) => t.id === kOrder.tableId);
    if (table) {
      if (nextStatus === "preparing") table.status = "Preparing";
      else if (nextStatus === "ready") {
        table.status = "Ready to Serve";
        kitchenOrders = kitchenOrders.filter((o) => o.id !== orderId);
        io.emit("toast", {
          msg: `Order for ${table.id} is Ready!`,
          type: "success",
          roleTarget: "Waiter",
        });
      }
    }
    broadcastState();
  });

  socket.on("broadcast_history", (history) => {
    if (history && history.length >= globalOrderHistory.length) {
      globalOrderHistory = history;
      socket.broadcast.emit("sync_history", globalOrderHistory);
    }
  });

  // NEW: Listen for a device adding a Waiter and radio it to everyone!
  socket.on("broadcast_staff", (staff) => {
    globalStaff = staff;
    socket.broadcast.emit("sync_staff", globalStaff);
  });

  // NEW: Listen for a device adding a Product and radio it to everyone!
  socket.on("broadcast_products", (products) => {
    globalProducts = products;
    socket.broadcast.emit("sync_products", globalProducts);
  });
});

const PORT = 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `\n✅ Local Hub running! Open http://localhost:${PORT} in your browser.`,
  );
});
