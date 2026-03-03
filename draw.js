
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let drawing = false;
let brushSize = 5;
let color = "#ffffff";
let mode = "pen";

const brush = document.getElementById("brush");
const colorPicker = document.getElementById("color");
const penBtn = document.getElementById("penBtn");
const eraserBtn = document.getElementById("eraserBtn");

brush.oninput = e => brushSize = e.target.value;
colorPicker.oninput = e => color = e.target.value;

penBtn.onclick = ()=>{
  mode="pen";
  penBtn.classList.add("active");
  eraserBtn.classList.remove("active");
};
eraserBtn.onclick = ()=>{
  mode="eraser";
  eraserBtn.classList.add("active");
  penBtn.classList.remove("active");
};

function resize(){
  const ratio = canvas.width / canvas.height;
  const maxW = window.innerWidth;
  const maxH = window.innerHeight - 120;

  let w = maxW;
  let h = w / ratio;

  if(h > maxH){
    h = maxH;
    w = h * ratio;
  }

  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
}
resize();
window.addEventListener("resize", resize);

function getPos(e){
  const rect = canvas.getBoundingClientRect();
  return {
    x:(e.clientX - rect.left)*(canvas.width/rect.width),
    y:(e.clientY - rect.top)*(canvas.height/rect.height)
  };
}

function start(e){
  drawing=true;
  const p=getPos(e);
  ctx.beginPath();
  ctx.moveTo(p.x,p.y);
}
function move(e){
  if(!drawing)return;
  const p=getPos(e);
  ctx.lineWidth=brushSize;
  ctx.lineCap="round";
  ctx.strokeStyle=(mode==="eraser")?"#111":color;
  ctx.lineTo(p.x,p.y);
  ctx.stroke();
}
function stop(){ drawing=false; }

canvas.addEventListener("mousedown",start);
canvas.addEventListener("mousemove",move);
canvas.addEventListener("mouseup",stop);

canvas.addEventListener("touchstart",e=>start(e.touches[0]));
canvas.addEventListener("touchmove",e=>{
  e.preventDefault();
  move(e.touches[0]);
},{passive:false});
canvas.addEventListener("touchend",stop);

// Backgrounds
document.getElementById("bgGrid").onclick=()=>{
  canvas.style.backgroundImage="linear-gradient(#1e293b 1px, transparent 1px), linear-gradient(90deg,#1e293b 1px,transparent 1px)";
  canvas.style.backgroundSize="20px 20px";
};
document.getElementById("bgPaper").onclick=()=>{
  canvas.style.background="#f8f5e6";
  ctx.fillStyle="#f8f5e6";
  ctx.fillRect(0,0,canvas.width,canvas.height);
};
document.getElementById("bgDark").onclick=()=>{
  canvas.style.background="#111";
};

// Publish to Cloudflare API
document.getElementById("publish").onclick=async ()=>{
  const caption=document.getElementById("caption").value;
  const dataUrl=canvas.toDataURL("image/png");

  const res=await fetch("/api/drawing",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({dataUrl,caption})
  });

  const data=await res.json();
  if(res.ok){
    window.location.href="gallery.html";
  }else{
    alert(data.error||"error");
  }
};
