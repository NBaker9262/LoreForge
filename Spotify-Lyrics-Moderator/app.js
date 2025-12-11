// ==== AUTH ====

const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const appContainer = document.getElementById("app");

loginBtn.onclick = async () => {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(firebaseAuth, provider);
};

logoutBtn.onclick = async () => {
  await signOut(firebaseAuth);
};

// Auth state listener
onAuthStateChanged(firebaseAuth, user => {
  if (user) {
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    appContainer.style.display = "block";

    document.getElementById("username").innerText = user.displayName;
    document.getElementById("uid").innerText = user.uid;

    listenForTokens();
  } else {
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    appContainer.style.display = "none";
  }
});


// ==== CHARACTER STORAGE (LOCAL) ====

document.getElementById("save-character").onclick = () => {
  const data = document.getElementById("character-data").value;
  localStorage.setItem("character", data);
  alert("Character saved locally!");
};

document.getElementById("load-character").onclick = () => {
  const data = localStorage.getItem("character");
  if (data) document.getElementById("character-data").value = data;
};


// ==== MAP UPLOAD ====

const mapCanvas = document.getElementById("map-canvas");
const mapCtx = mapCanvas.getContext("2d");
let mapImage = null;

document.getElementById("map-upload").onchange = e => {
  const file = e.target.files[0];
  const reader = new FileReader();
  reader.onload = function (evt) {
    mapImage = new Image();
    mapImage.src = evt.target.result;
    mapImage.onload = () => renderMap();
  };
  reader.readAsDataURL(file);
};

function renderMap() {
  if (!mapImage) return;
  mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  mapCtx.drawImage(mapImage, 0, 0, mapCanvas.width, mapCanvas.height);

  for (let id in tokens) drawToken(tokens[id]);
}


// ==== TOKENS (REALTIME SYNCED) ====

let tokens = {};

document.getElementById("add-token").onclick = () => {
  const user = firebaseAuth.currentUser;
  if (!user) return;

  const t = {
    uid: user.uid,
    x: Math.random() * 700,
    y: Math.random() * 500,
    color: "#ffcc00"
  };

  setDB(refDB(firebaseDB, "tokens/" + user.uid), t);
};

function listenForTokens() {
  onValueDB(refDB(firebaseDB, "tokens"), snapshot => {
    tokens = snapshot.val() || {};
    renderMap();
  });
}

function drawToken(t) {
  mapCtx.fillStyle = t.color;
  mapCtx.beginPath();
  mapCtx.arc(t.x, t.y, 15, 0, Math.PI * 2);
  mapCtx.fill();
}


// ==== DICE ====

document.querySelectorAll(".roll").forEach(btn => {
  btn.onclick = () => {
    const sides = Number(btn.dataset.sides);
    const result = Math.floor(Math.random() * sides) + 1;
    document.getElementById("dice-output").innerText = `Rolled d${sides}: ${result}`;
  };
});


// ==== AI COMING SOON ====

console.log("AI tools will be added later...");
