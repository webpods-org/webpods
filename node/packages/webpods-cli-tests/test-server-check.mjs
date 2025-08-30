#!/usr/bin/env node

async function checkServer() {
  console.log('Checking if server is running on port 3456...');
  
  try {
    const response = await fetch('http://localhost:3456/health');
    console.log('Server status:', response.status);
    const text = await response.text();
    console.log('Response:', text);
  } catch (error) {
    console.log('Server error:', error.message);
  }
}

checkServer();