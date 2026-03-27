class KalaMudra {
    constructor() {
        this.mudras = [];
        this.currentMudra = null;
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
        this.camera = null;
        this.progress = JSON.parse(localStorage.getItem('kalamudraProgress')) || {};
        this.init();
    }

    async init() {
        await this.loadMudras();
        this.bindEvents();
        this.renderMudraLibrary();
        this.renderProgress();
        this.setupHands();
    }

    async loadMudras() {
        const response = await fetch('mudras.json');
        this.mudras = await response.json();
    }

    bindEvents() {
        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelector('.nav-btn.active').classList.remove('active');
                e.target.classList.add('active');
                document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
                document.getElementById(e.target.id.replace('Btn', '')).classList.add('active');
            });
        });

        // Search
        document.getElementById('searchInput').addEventListener('input', (e) => this.filterMudras(e.target.value));

        // Modal
        document.getElementById('mudraModal').querySelector('.close').addEventListener('click', () => {
            document.getElementById('mudraModal').style.display = 'none';
        });

        document.getElementById('practiceFromModal').addEventListener('click', () => {
            this.selectMudraForPractice(this.currentMudra);
            document.getElementById('mudraModal').style.display = 'none';
            document.getElementById('practice').classList.add('active');
            document.querySelector('#practiceBtn').classList.add('active');
            document.querySelector('.nav-btn.active')?.classList.remove('active');
        });
    }

    renderMudraLibrary(filter = '') {
        const list = document.getElementById('mudraList');
        list.innerHTML = this.mudras
            .filter(mudra => mudra.name.toLowerCase().includes(filter.toLowerCase()))
            .map(mudra => `
                <div class="mudra-card" data-id="${mudra.id}">
                    <img src="${mudra.image}" alt="${mudra.name}" onerror="this.src='https://via.placeholder.com/300x200/8B0000/FFF8DC?text=${mudra.name}'">
                    <h3>${mudra.name}</h3>
                    <p>${mudra.meaning}</p>
                </div>
            `).join('');

        // Card clicks
        document.querySelectorAll('.mudra-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.id;
                this.showMudraDetails(id);
            });
        });
    }

    filterMudras(query) {
        this.renderMudraLibrary(query);
    }

    showMudraDetails(id) {
        this.currentMudra = this.mudras.find(m => m.id === id);
        document.getElementById('modalImg').src = this.currentMudra.image;
        document.getElementById('modalName').textContent = this.currentMudra.name;
        document.getElementById('modalMeaning').textContent = this.currentMudra.meaning;
        document.getElementById('modalUsage').textContent = `Usage: ${this.currentMudra.usage}`;
        document.getElementById('modalHistory').textContent = `History: ${this.currentMudra.history}`;
        document.getElementById('mudraModal').style.display = 'block';
    }

    selectMudraForPractice(mudra) {
        this.currentMudra = mudra;
        document.getElementById('practiceTitle').textContent = `Practice: ${mudra.name}`;
        document.getElementById('startPractice').style.display = 'block';
        document.getElementById('retryBtn').style.display = 'none';
        document.getElementById('feedback').textContent = '';
        document.getElementById('result').innerHTML = '';
    }

    async setupHands() {
        this.hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.5
        });

        this.hands.onResults(this.onHandsResults.bind(this));
    }

    async startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
            this.video.srcObject = stream;
            this.camera = new Camera(this.video, {
                onFrame: async () => {
                    await this.hands.send({image: this.video});
                },
                width: 640,
                height: 480
            });
            this.camera.start();
        } catch (err) {
            alert('Camera access denied. Please allow camera permission.');
        }
    }

    onHandsResults(results) {
        this.ctx.save();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;

        if (results.multiHandLandmarks && results.multiHandedness) {
            for (let i = 0; i < results.multiHandLandmarks.length; i++) {
                const landmarks = results.multiHandLandmarks[i];
                const handedness = results.multiHandedness[i];

                // Draw landmarks
                drawConnectors(this.ctx, landmarks, HAND_CONNECTIONS, {color: '#DAA520', lineWidth: 3});
                drawLandmarks(this.ctx, landmarks, {color: '#FF9933', lineWidth: 2});

                // Analyze angles if practicing
                if (this.currentMudra) {
                    this.analyzeMudra(landmarks);
                }
            }
        }
        this.ctx.restore();
    }

    analyzeMudra(landmarks) {
        const angles = this.calculateFingerAngles(landmarks);
        let totalError = 0;
        let errors = [];

        Object.keys(this.currentMudra.idealAngles).forEach(finger => {
            const diff = Math.abs(angles[finger] - this.currentMudra.idealAngles[finger]);
            totalError += diff;
            if (diff > 15) {  // Threshold for error
                errors.push(`${finger}: ${Math.round(diff)}° off`);
            }
        });

        const avgError = totalError / Object.keys(this.currentMudra.idealAngles).length;
        document.getElementById('feedback').textContent = `Avg Error: ${Math.round(avgError)}°`;

        if (avgError < 15) {
            document.getElementById('result').innerHTML = '<div class="result correct">✅ Perfect! Mudra Correct.</div>';
            this.updateProgress(this.currentMudra.id, 'success');
        } else if (avgError < 30) {
            document.getElementById('result').innerHTML = `<div class="result incorrect">⚠️ Close! Errors: ${errors.join(', ')}</div>`;
        } else {
            document.getElementById('result').innerHTML = `<div class="result incorrect">❌ Incorrect. Try again.</div>`;
        }
    }

    calculateFingerAngles(landmarks) {
        const lm = landmarks.map(p => ({x: p.x * this.canvas.width, y: p.y * this.canvas.height}));
        
        // Simplified angle calc for fingers (PIP joints)
        // Thumb (4-3-2), Index(8-6-5), etc. using atan2
        function angleAt(i1, i2, i3) {
            const v1 = {x: lm[i1].x - lm[i2].x, y: lm[i1].y - lm[i2].y};
            const v2 = {x: lm[i3].x - lm[i2].x, y: lm[i3].y - lm[i2].y};
            const dot = v1.x * v2.x + v1.y * v2.y;
            const det = v1.x * v2.y - v1.y * v2.x;
            return (Math.atan2(det, dot) * 180 / Math.PI + 360) % 360;
        }

        return {
            thumb: angleAt(4, 3, 2),
            index: angleAt(8, 6, 5),
            middle: angleAt(12, 10, 9),
            ring: angleAt(16, 14, 13),
            pinky: angleAt(20, 18, 17)
        };
    }

    updateProgress(mudraId, result) {
        if (!this.progress[mudraId]) this.progress[mudraId] = { attempts: 0, successes: 0 };
        this.progress[mudraId].attempts++;
        if (result === 'success') this.progress[mudraId].successes++;
        localStorage.setItem('kalamudraProgress', JSON.stringify(this.progress));
        this.renderProgress();
    }

    renderProgress() {
        const list = document.getElementById('progressList');
        list.innerHTML = Object.entries(this.progress)
            .map(([id, data]) => {
                const mudra = this.mudras.find(m => m.id === id);
                const successRate = ((data.successes / data.attempts) * 100).toFixed(1);
                return `
                    <div class="progress-item">
                        <h3>${mudra ? mudra.name : id}</h3>
                        <p>Attempts: ${data.attempts} | Success: ${successRate}%</p>
                    </div>
                `;
            }).join('') || '<p>No practice sessions yet. Start practicing!</p>';
    }
}

// Event listeners for practice buttons
document.addEventListener('DOMContentLoaded', () => {
    const app = new KalaMudra();

    document.getElementById('startPractice').addEventListener('click', () => {
        app.selectMudraForPractice(app.currentMudra);
        app.startCamera();
        document.getElementById('startPractice').style.display = 'none';
        document.getElementById('retryBtn').style.display = 'inline-block';
    });

    document.getElementById('retryBtn').addEventListener('click', () => {
        document.getElementById('feedback').textContent = '';
        document.getElementById('result').innerHTML = '';
        if (app.camera) app.camera.start();  // Restart frame processing
    });
});