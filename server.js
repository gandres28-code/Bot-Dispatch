const express = require("express");
const axios = require("axios");

const app = express();

app.use(express.json());

// 🔑 ENV
const WHAPI_TOKEN = process.env.WHAPI_TOKEN || "";
const OPERATIONS_GROUP_ID = process.env.OPERATIONS_GROUP_ID || "";
const INSPECTION_GROUP_ID = process.env.INSPECTION_GROUP_ID || "";

// 🏨 GRUPOS
const ALLOWED_GROUPS = [
"[120363427834097943@g.us](mailto:120363427834097943@g.us)",
"[120363425416827106@g.us](mailto:120363425416827106@g.us)",
"[120363408939064520@g.us](mailto:120363408939064520@g.us)",
"[120363428515985008@g.us](mailto:120363428515985008@g.us)",
"[120363425695848832@g.us](mailto:120363425695848832@g.us)",
"[120363408317536314@g.us](mailto:120363408317536314@g.us)"
];

// 🧠 MEMORIA
const pendingMedia = {};
const processed = new Set();

// 🧹 limpieza
setInterval(() => {

const now = Date.now();

for (const k in pendingMedia) {

if (
now -
pendingMedia[k].time >
1800000
) {

delete pendingMedia[k];

}

}

processed.clear();

},600000);

// 🟢 HEALTH
app.get("/",(req,res)=>{

res.send(
"Bot hotelero activo ✅"
);

});

// 📩 WEBHOOK
app.post(
"/webhook",
async(req,res)=>{

try{

const msg =
req.body?.messages?.[0];

if(!msg)
return res.sendStatus(200);

if(
msg?.type==="action"||
msg?.from_me
){
return res.sendStatus(200);
}

const chatId =
msg?.chat_id;

if(
!ALLOWED_GROUPS.includes(
chatId
)
){
return res.sendStatus(200);
}

const employee =
msg?.from_name ||
"Desconocido";

const eventId =
msg?.id ||
(
chatId+
msg?.timestamp
);

if(
processed.has(
eventId
)
){
return res.sendStatus(200);
}

processed.add(
eventId
);

// 📸 FOTO
if(
msg?.type==="image"
){

pendingMedia[
chatId+
"_"+msg?.from
]={
time:Date.now()
};

return res.sendStatus(200);

}

// ✍️ MENSAJE
const message =
msg?.text?.body||
msg?.text||
msg?.message||
"";

if(
!message.trim()
){
return res.sendStatus(200);
}

console.log(
"📨",
message
);

const lower =
message.toLowerCase();

// 🔎 UNIDAD
const unitMatch =
message.match(
/(\d{2,4})\s*(A\s*Y\s*B|B\s*Y\s*A|A|B)?/i
);

let unit="";

if(unitMatch){

unit=
(unitMatch[1]||"")
.trim();

if(unitMatch[2]){

unit+=
" "+
unitMatch[2]
.toUpperCase()
.replace(
/\s+/g,
" "
);

}

}

// 🚦 ESTADO
let report="";

// ENTRADA
if(

lower.includes("entre")||
lower.includes("entré")||
lower.includes("entrando")||
lower.includes("ya llegue")||
lower.includes("ya llegué")

){

report=
employee+
" entró a "+
(unit||"la unidad");

}

// LIMPIEZA
else if(

lower.includes("limpiando")||
lower.includes("empece")||
lower.includes("empecé")||
lower.includes("trabajando")

){

report=
employee+
" está limpiando "+
(unit||"la unidad");

}

// LISTA
else if(

lower.includes("lista")||
lower.includes("terminada")||
lower.includes("finalizada")

){

report=
employee+
" terminó "+
(unit||"la unidad");

}

// SALIDA
else if(

lower.includes("salgo")||
lower.includes("salí")||
lower.includes("sali")

){

report=
employee+
" salió de "+
(unit||"la unidad");

}

// NECESITA ALGO
else if(

lower.includes("hay")||
lower.includes("falta")||
lower.includes("maleta")||
lower.includes("equipaje")||
lower.includes("problema")||
lower.includes("sucio")||
lower.includes("mantenimiento")||
lower.includes("necesito")

){

report=
employee+
" necesita atención en "+
(unit||"la unidad");

}

// ignorar casual
else{

return res.sendStatus(200);

}

// 🕒 HORA
const time =
new Date()
.toLocaleTimeString(
"en-US",
{
timeZone:
"America/Mexico_City",
hour:"2-digit",
minute:"2-digit",
hour12:true
}
);

// 📤 OPERACIONES
await axios.post(

"https://gate.whapi.cloud/messages/text",

{

to:
OPERATIONS_GROUP_ID,

body:

"🕒 "+
time+

"\n\n"+

report

},

{

headers:{

Authorization:
"Bearer "+
WHAPI_TOKEN

}

}

);

console.log(
"✅ operaciones"
);

// 🔎 INSPECTORES
const ready =

lower.includes(
"lista"
)

||

lower.includes(
"terminada"
)

||

lower.includes(
"finalizada"
);

if(
ready &&
unit &&
INSPECTION_GROUP_ID
){

await axios.post(

"https://gate.whapi.cloud/messages/text",

{

to:
INSPECTION_GROUP_ID,

body:
unit+
" lista para inspeccionar"

},

{

headers:{

Authorization:
"Bearer "+
WHAPI_TOKEN

}

}

);

console.log(
"🔎 inspectores"
);

}

return res.sendStatus(200);

}catch(err){

console.log(
err.response?.data||
err.message
);

return res.sendStatus(200);

}

});

const PORT=
process.env.PORT||
3000;

app.listen(
PORT,
()=>{

console.log(
"Servidor hotelero listo"
);

}
);
