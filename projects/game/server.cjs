const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp" };
http.createServer((req,res)=>{
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (req.method === "POST" && urlPath === "/save-office-video") {
    const target = path.join(root, "david-ray-monitor-transition.webm");
    const output = fs.createWriteStream(target);
    req.pipe(output);
    req.on("end",()=>{ res.writeHead(200,{"Content-Type":"text/plain"}); res.end("saved"); });
    return;
  }
  if (req.method === "POST" && urlPath === "/save-cropped-video") {
    const target = path.join(root, "office-video-cropped.mp4.webm");
    const output = fs.createWriteStream(target);
    req.pipe(output);
    req.on("end",()=>{ res.writeHead(200,{"Content-Type":"text/plain"}); res.end("saved"); });
    return;
  }
  const requested = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.resolve(root, requested);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file,(error,data)=>{
    if(error){res.writeHead(404);return res.end("Not found");}
    res.writeHead(200,{"Content-Type":types[path.extname(file).toLowerCase()]||"application/octet-stream","Cache-Control":"no-store"});
    res.end(data);
  });
}).listen(Number(process.env.PORT || 4173),"127.0.0.1");
