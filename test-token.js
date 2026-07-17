const crypto = require('crypto');
const secret = "test";
const data = "m:u:123";
const sig = crypto.createHmac("sha256", secret).update(data).digest("hex");
const token = `${data}:${sig}`;
console.log(token.split(":").length);
