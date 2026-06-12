const express = require("express");
const axios = require("axios");

const app = express();

app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.get("/", (req,res)=>{
  res.send("Bot activo y funcionando ✅");
});


app.post("/webhook", async (req,res)=>{

  try {

    const message =
      req.body.body ||
      req.body.text ||
      "mensaje vacío";


    console.log("📩 Mensaje recibido:", message);


    const ai = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model:"gpt-4o-mini",
        messages:[
          {
            role:"system",
            content:
            `
Eres un asistente de operaciones de housekeeping.

Analiza mensajes.

Extrae:
- Unidad
- Empleado
- Estado
- Problema
- Hora

Estados posibles:
ENTRANDO
LIMPIANDO
LISTA
INSPECCIONADA
PROBLEMA
SUMINISTROS

Devuelve un reporte corto para supervisor.
`
          },
          {
            role:"user",
            content: message
          }
        ]
      },
      {
        headers:{
          Authorization:`Bearer ${OPENAI_API_KEY}`,
          "Content-Type":"application/json"
        }
      }
    );


    const result =
      ai.data.choices[0].message.content;


    console.log("🤖 IA:", result);


    res.json({
      ok:true,
      respuesta:result
    });


  } catch(error){

    console.log(
      error.response?.data || error.message
    );

    res.sendStatus(500);

  }

});


const PORT = process.env.PORT || 3000;

app.listen(PORT,()=>{
 console.log("Servidor activo en",PORT);
});
