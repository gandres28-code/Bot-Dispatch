const express = require("express");

const app = express();

app.use(express.json());

// health check (Render lo necesita para saber que está vivo)
app.get("/", (req, res) => {
  res.send("Bot activo y funcionando ✅");
});

// webhook prueba
app.get("/webhook", (req, res) => {
  res.send("Webhook listo ✅");
});

// recibir mensajes (luego conectamos Whapi aquí)
app.post("/webhook", (req, res) => {
  console.log("Mensaje recibido:", req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
