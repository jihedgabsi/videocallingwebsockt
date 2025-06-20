// webrtc-signaling-server/server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
    cors: {
        origin: "http://localhost:3000", // Assurez-vous que c'est la bonne origine pour votre client Next.js
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3001;

// Pour stocker les sockets des utilisateurs et les salles
const users = {}; // { socketId: socket }
const rooms = {}; // { roomId: { [socketId]: socket, ... } }

io.on('connection', (socket) => {
    console.log(`Nouvel utilisateur connecté : ${socket.id}`);

    // Ajouter l'utilisateur à notre liste globale
    users[socket.id] = socket;

    // Événement pour rejoindre une salle
    socket.on('join-room', (roomId, callback) => {
        console.log(`Utilisateur ${socket.id} tente de rejoindre la salle ${roomId}`);

        if (!rooms[roomId]) {
            rooms[roomId] = {};
        }

        // Ajouter le socket à la salle
        rooms[roomId][socket.id] = socket;
        socket.join(roomId); // Socket.IO permet de joindre des "salles"

        console.log(`Utilisateur ${socket.id} a rejoint la salle ${roomId}`);

        // Informer les autres utilisateurs déjà dans la salle
        // Emettre à tous les clients dans la salle SAUF l'émetteur
        socket.to(roomId).emit('user-joined', socket.id);

        // Envoyer à l'utilisateur qui vient de joindre la liste des participants déjà dans la salle
        const participantsInRoom = Object.keys(rooms[roomId]).filter(id => id !== socket.id);
        if (callback) {
            callback(participantsInRoom); // Envoyer la liste des participants à l'appelant
        }
    });

    // Gérer l'envoi d'offres WebRTC (SDP offer)
    socket.on('offer', (offer, targetSocketId) => {
        console.log(`Offre reçue de ${socket.id} pour ${targetSocketId}`);
        // Transmettre l'offre à l'utilisateur cible
        if (users[targetSocketId]) {
            users[targetSocketId].emit('offer', offer, socket.id);
        }
    });

    // Gérer l'envoi de réponses WebRTC (SDP answer)
    socket.on('answer', (answer, targetSocketId) => {
        console.log(`Réponse reçue de ${socket.id} pour ${targetSocketId}`);
        // Transmettre la réponse à l'utilisateur cible
        if (users[targetSocketId]) {
            users[targetSocketId].emit('answer', answer, socket.id);
        }
    });

    // Gérer l'envoi de candidats ICE
    socket.on('ice-candidate', (candidate, targetSocketId) => {
        console.log(`Candidat ICE reçu de ${socket.id} pour ${targetSocketId}`);
        // Transmettre le candidat ICE à l'utilisateur cible
        if (users[targetSocketId]) {
            users[targetSocketId].emit('ice-candidate', candidate, socket.id);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Utilisateur déconnecté : ${socket.id}`);

        // Supprimer l'utilisateur de la liste globale
        delete users[socket.id];

        // Parcourir les salles et supprimer l'utilisateur si présent
        for (const roomId in rooms) {
            if (rooms[roomId][socket.id]) {
                delete rooms[roomId][socket.id];
                // Si la salle devient vide, la supprimer
                if (Object.keys(rooms[roomId]).length === 0) {
                    delete rooms[roomId];
                    console.log(`Salle ${roomId} supprimée car vide.`);
                } else {
                    // Informer les autres utilisateurs dans la même salle de la déconnexion
                    socket.to(roomId).emit('user-left', socket.id);
                }
            }
        }
        // Pour un chat 1-à-1 simple, on informait tous. Ici, on est plus précis par salle.
        // Si vous voulez conserver l'information globale d'utilisateurs connectés, vous pouvez la réactiver.
        // io.emit('user-disconnected', socket.id); // Décommenter si nécessaire pour d'autres fonctionnalités
    });
});

server.listen(PORT, () => {
    console.log(`Serveur de signalisation démarré sur http://localhost:${PORT}`);
});