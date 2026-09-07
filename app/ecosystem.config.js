module.exports = {
  apps: [{
    name: "paudio",
    script: "npm",
    args: "run start",
    cwd: "C:\\Users\\steve\\Development\\paudio\\app",
    instances: 1,
    autorestart: true,
    watch: false
  }]
}
