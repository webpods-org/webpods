const { execSync } = require("child_process");

// Start server
console.log("Starting server...");
const server = require("child_process").spawn("npm", ["run", "start"], {
  cwd: "/home/jeswin/repos/webpods-org/webpods",
  stdio: "pipe",
});

// Wait for server to start
setTimeout(() => {
  console.log("Running test...");
  try {
    const result = execSync(
      'npx mocha --grep "should create .meta/streams/owner" --bail',
      {
        stdio: "inherit",
      },
    );
  } catch (e) {
    console.log("Test failed");
  }

  server.kill();
  process.exit(0);
}, 3000);
