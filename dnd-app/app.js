// ----------------------
// Firebase Setup
// ----------------------
const firebaseConfig = {
    apiKey: "AIzaSyA66xqYt8GZCxRxegAo8ilq2tmqEL4mC_0",
    authDomain: "loreforge-e5c62.firebaseapp.com",
    projectId: "loreforge-e5c62",
    storageBucket: "loreforge-e5c62.firebasestorage.app",
    messagingSenderId: "529682812294",
    appId: "1:529682812294:web:7e4b9cf64b48e813dff007",
    measurementId: "G-E3HLEWVKJN"
};

const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

let currentUser = null;
let userRole = "player";

let selectedToken = null;
let shiftHeld = false;

// ----------------------
// Auth
// ----------------------
function login() {
    const email = document.getElementById("email").value;
    const pass = document.getElementById("password").value;

    auth.signInWithEmailAndPassword(email, pass)
        .then(res => {
            console.log("Logged in:", res.user.uid);
        })
        .catch(err => alert(err.message));
}

function signup() {
    const email = document.getElementById("email").value;
    const pass = document.getElementById("password").value;

    auth.createUserWithEmailAndPassword(email, pass)
        .then(res => {
            db.ref("users/" + res.user.uid).set({
                role: "player",
                pfp: "https://i.imgur.com/1Q9Z1Zm.png"
            });
        })
        .catch(err => alert(err.message));
}

auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById("auth-section").style.display = "none";
        document.getElementById("app").style.display = "block";

        let roleSnap = await db.ref("users/" + user.uid + "/role").get();
        userRole = roleSnap.exists() ? roleSnap.val() : "player";

        document.getElementById("role-display").innerText = "Role: " + userRole;

        if (userRole !== "dm") {
            document.getElementById("dm-tools").style.display = "none";
        }

        loadTokens();
    }
});

// ----------------------
// Map Upload + Auto Resize
// ----------------------
document.getElementById("mapUpload").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const img = document.getElementById("battlemap");
    img.src = URL.createObjectURL(file);

    img.onload = () => {
        img.style.width = img.naturalWidth + "px";
        img.style.height = img.naturalHeight + "px";
    };
});

// ----------------------
// Token Creation
// ----------------------
async function addToken() {
    if (userRole !== "dm") return alert("Only DM can add tokens.");

    const pfpSnap = await db.ref("users/" + currentUser.uid + "/pfp").get();
    const pfp = pfpSnap.exists() ? pfpSnap.val() : "";

    const tokenRef = db.ref("tokens").push();
    tokenRef.set({
        owner: currentUser.uid,
        x: 100,
        y: 100,
        pfp: pfp
    });
}

function loadTokens() {
    db.ref("tokens").on("value", (snap) => {
        document.querySelectorAll(".token").forEach(el => el.remove());

        snap.forEach(child => {
            const data = child.val();
            createTokenElement(child.key, data);
        });
    });
}

function createTokenElement(id, data) {
    const token = document.createElement("img");
    token.src = data.pfp;
    token.className = "token";
    token.style.left = data.x + "px";
    token.style.top = data.y + "px";
    token.dataset.id = id;
    token.dataset.owner = data.owner;

    token.addEventListener("mousedown", () => {
        selectedToken = token;
        token.classList.add("selected");
    });

    document.getElementById("map-container").appendChild(token);

    makeDraggable(token);
}

// ----------------------
// Drag Tokens
// ----------------------
function makeDraggable(el) {
    let offsetX, offsetY;

    el.addEventListener("mousedown", function (e) {
        if (userRole !== "dm" && el.dataset.owner !== currentUser.uid) {
            if (!shiftHeld) return; // shift override
        }

        offsetX = e.clientX - el.offsetLeft;
        offsetY = e.clientY - el.offsetTop;

        function move(e2) {
            el.style.left = (e2.clientX - offsetX) + "px";
            el.style.top = (e2.clientY - offsetY) + "px";
        }

        function up() {
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", up);

            db.ref("tokens/" + el.dataset.id).update({
                x: parseInt(el.style.left),
                y: parseInt(el.style.top)
            });
        }

        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
    });
}

document.addEventListener("click", (e) => {
    if (!e.target.classList.contains("token")) {
        if (selectedToken) selectedToken.classList.remove("selected");
        selectedToken = null;
    }
});

// ----------------------
// Remove / Edit Token
// ----------------------
function removeSelectedToken() {
    if (!selectedToken) return alert("No token selected.");
    if (userRole !== "dm") return alert("Only DM can remove.");

    db.ref("tokens/" + selectedToken.dataset.id).remove();
}

function editSelectedToken() {
    if (!selectedToken) return alert("No token selected.");
    if (userRole !== "dm") return alert("Only DM can edit.");

    let newUrl = prompt("New PFP URL:", selectedToken.src);
    if (!newUrl) return;

    db.ref("tokens/" + selectedToken.dataset.id).update({
        pfp: newUrl
    });
}

// ----------------------
// SHIFT Key
// ----------------------
document.addEventListener("keydown", (e) => {
    if (e.key === "Shift") shiftHeld = true;
});
document.addEventListener("keyup", (e) => {
    if (e.key === "Shift") shiftHeld = false;
});

// ----------------------
// Dice Roller
// ----------------------
function rollPure(max) {
    return Math.floor(Math.random() * max) + 1;
}

function rollDice(sides) {
    const r = rollPure(sides);
    displayRoll(`1d${sides}: ${r}`);
}

function rollAdv() {
    const a = rollPure(20);
    const b = rollPure(20);
    displayRoll(`Advantage: ${a} / ${b} → ${Math.max(a, b)}`);
}

function rollDis() {
    const a = rollPure(20);
    const b = rollPure(20);
    displayRoll(`Disadvantage: ${a} / ${b} → ${Math.min(a, b)}`);
}

function displayRoll(text) {
    document.getElementById("roll-output").innerText = text;
}
