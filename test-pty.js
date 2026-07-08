const pty = require("node-pty");
const shell = process.env.SHELL ?? "/bin/bash";
const initCmd = 'az login ; exec /bin/bash -i';
const p = pty.spawn(shell, ["-c", initCmd], {
  name: "xterm-256color",
  cols: 80,
  rows: 24,
  env: process.env
});
p.onData(data => console.log("DATA:", JSON.stringify(data)));
p.onExit(e => console.log("EXIT:", e));
setTimeout(() => { p.write("ls\r"); }, 1000);
setTimeout(() => { p.kill(); }, 3000);
