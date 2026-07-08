const http = require('http');

const data = JSON.stringify({
  email: "admin@example.com",
  password: "admin", // wait, what is the password?
  redirect: false,
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/auth/callback/credentials',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, res => {
  console.log(`STATUS: ${res.statusCode}`);
  console.log(`HEADERS: ${JSON.stringify(res.headers, null, 2)}`);
  res.on('data', d => process.stdout.write(d));
});

req.on('error', e => console.error(e));
req.write(data);
req.end();
