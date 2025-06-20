// webrtc-nextjs-client/app/page.js
"use client";

import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
// Supprimez `import Head from 'next/head';` si vous êtes dans l'App Router,
// et gérez les métadonnées via l'export `metadata` ou directement dans `layout.js`
// const Head = require('next/head'); // Ou importez le si vous utilisez le Pages Router

const SIGNALING_SERVER_URL = 'http://localhost:3001';
const peerConnectionConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ],
};

export default function Home() {
    const localVideoRef = useRef();
    const remoteVideoRef = useRef(); // Pour un appel 1-à-1, on n'a qu'une seule vidéo distante
    const peerConnectionsRef = useRef({}); // Stocke les RTCPeerConnection pour chaque pair
    const socketRef = useRef(null);

    const [localStream, setLocalStream] = useState(null);
    const [myRoomId, setMyRoomId] = useState('');
    const [currentRoom, setCurrentRoom] = useState('');
    const [peersInRoom, setPeersInRoom] = useState([]); // Utilisateurs actuellement dans la même salle
    const [mySocketId, setMySocketId] = useState(null);

    useEffect(() => {
        socketRef.current = io(SIGNALING_SERVER_URL);

        socketRef.current.on('connect', () => {
            console.log('Connecté au serveur de signalisation avec ID:', socketRef.current.id);
            setMySocketId(socketRef.current.id);
        });

        // Gérer les nouveaux utilisateurs rejoignant la salle
        socketRef.current.on('user-joined', (newUserId) => {
            console.log('Un nouvel utilisateur a rejoint la salle:', newUserId);
            setPeersInRoom(prevPeers => [...prevPeers, newUserId]);
            // Si un nouvel utilisateur rejoint, initier une offre pour lui (ou vice-versa)
            if (localStream && newUserId !== socketRef.current.id) {
                 createOffer(newUserId);
            }
        });

        // Gérer les utilisateurs quittant la salle
        socketRef.current.on('user-left', (leavingUserId) => {
            console.log('Un utilisateur a quitté la salle:', leavingUserId);
            setPeersInRoom(prevPeers => prevPeers.filter(id => id !== leavingUserId));
            // Nettoyer la connexion RTCPeerConnection si elle existe
            if (peerConnectionsRef.current[leavingUserId]) {
                peerConnectionsRef.current[leavingUserId].close();
                delete peerConnectionsRef.current[leavingUserId];
                // Si c'était la personne avec qui nous étions en appel 1-1, nettoyez la vidéo distante
                if (remoteVideoRef.current && remoteVideoRef.current.dataset.peerId === leavingUserId) {
                     remoteVideoRef.current.srcObject = null;
                     delete remoteVideoRef.current.dataset.peerId;
                }
            }
        });


        socketRef.current.on('offer', async (offer, fromSocketId) => {
            console.log(`Offre reçue de ${fromSocketId}`);
            if (!peerConnectionsRef.current[fromSocketId]) {
                createPeerConnection(fromSocketId);
            }
            const pc = peerConnectionsRef.current[fromSocketId];
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socketRef.current.emit('answer', answer, fromSocketId);
        });

        socketRef.current.on('answer', async (answer, fromSocketId) => {
            console.log(`Réponse reçue de ${fromSocketId}`);
            const pc = peerConnectionsRef.current[fromSocketId];
            if (pc && pc.signalingState !== "closed") {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
            }
        });

        socketRef.current.on('ice-candidate', async (candidate, fromSocketId) => {
            console.log(`Candidat ICE reçu de ${fromSocketId}`);
            try {
                const pc = peerConnectionsRef.current[fromSocketId];
                if (pc && pc.signalingState !== "closed") {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                }
            } catch (e) {
                console.error('Erreur lors de l\'ajout du candidat ICE:', e);
            }
        });

        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
            // Fermer toutes les connexions peer actives
            for (const peerId in peerConnectionsRef.current) {
                if (peerConnectionsRef.current[peerId]) {
                    peerConnectionsRef.current[peerId].close();
                }
            }
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }
        };
    }, [localStream]);

    const startLocalStream = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideoRef.current.srcObject = stream;
            setLocalStream(stream);
            console.log('Flux local obtenu.');
        } catch (err) {
            console.error('Erreur lors de l\'accès aux médias locaux:', err);
            alert("Impossible d'accéder à votre caméra ou micro. Veuillez vérifier les permissions.");
        }
    };

    const createPeerConnection = (targetSocketId) => {
        const pc = new RTCPeerConnection(peerConnectionConfig);

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`Envoi du candidat ICE à ${targetSocketId}:`, event.candidate);
                socketRef.current.emit('ice-candidate', event.candidate, targetSocketId);
            }
        };

        pc.ontrack = (event) => {
            console.log(`Piste distante reçue de ${targetSocketId}:`, event.streams[0]);
            // Pour un exemple 1-à-1 simple, on affichera le dernier flux reçu
            // Dans un vrai appel de groupe, vous auriez plusieurs éléments vidéo
            remoteVideoRef.current.srcObject = event.streams[0];
            remoteVideoRef.current.dataset.peerId = targetSocketId; // Pour savoir qui est affiché
        };

        if (localStream) {
            localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
        }

        peerConnectionsRef.current[targetSocketId] = pc;
        console.log(`Connexion Peer créée pour ${targetSocketId}.`);
        return pc;
    };

    const createOffer = async (targetSocketId) => {
        if (!localStream) {
            alert('Veuillez d\'abord démarrer votre caméra et micro.');
            return;
        }
        if (!peerConnectionsRef.current[targetSocketId]) {
            createPeerConnection(targetSocketId);
        }
        const pc = peerConnectionsRef.current[targetSocketId];

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current.emit('offer', offer, targetSocketId);
        console.log(`Offre envoyée à ${targetSocketId}`);
    };

    const joinRoom = () => {
        if (!myRoomId.trim()) {
            alert('Veuillez entrer un nom de salle valide.');
            return;
        }
        if (!localStream) {
             alert('Veuillez d\'abord démarrer votre caméra et micro.');
             return;
        }

        setCurrentRoom(myRoomId.trim());
        socketRef.current.emit('join-room', myRoomId.trim(), (existingParticipants) => {
            console.log('Participants déjà dans la salle:', existingParticipants);
            setPeersInRoom(existingParticipants);
            // Pour chaque participant existant, initier un appel
            existingParticipants.forEach(peerId => {
                if (peerId !== socketRef.current.id) { // Ne pas s'appeler soi-même
                    createOffer(peerId);
                }
            });
        });
    };

    const leaveRoom = () => {
        // Logique de déconnexion de tous les pairs dans la salle
        for (const peerId in peerConnectionsRef.current) {
            if (peerConnectionsRef.current[peerId]) {
                peerConnectionsRef.current[peerId].close();
                delete peerConnectionsRef.current[peerId];
            }
        }
        remoteVideoRef.current.srcObject = null;
        delete remoteVideoRef.current.dataset.peerId;

        socketRef.current.emit('leave-room', currentRoom); // Si vous ajoutez un événement leave-room sur le serveur
        setCurrentRoom('');
        setPeersInRoom([]);
    };


    return (
        <div className="App">
            <h1>Simple WebRTC Video Chat (Next.js - Salles)</h1>
            <p>Mon ID Socket : <strong>{mySocketId || 'Connexion...'}</strong></p>

            <div className="video-container">
                <div className="video-box">
                    <h2>Ma Vidéo</h2>
                    <video ref={localVideoRef} autoPlay playsInline muted></video>
                    {!localStream && (
                        <button onClick={startLocalStream}>Démarrer Ma Caméra & Micro</button>
                    )}
                </div>
                <div className="video-box">
                    <h2>Vidéo Distante</h2>
                    <video ref={remoteVideoRef} autoPlay playsInline></video>
                    {!remoteVideoRef.current?.srcObject && <p>En attente d'un appel ou d'une connexion...</p>}
                </div>
            </div>

            <hr />

            {!currentRoom ? (
                <div>
                    <h2>Rejoindre une Salle</h2>
                    <input
                        type="text"
                        placeholder="Nom de la salle"
                        value={myRoomId}
                        onChange={(e) => setMyRoomId(e.target.value)}
                    />
                    <button onClick={joinRoom} disabled={!localStream}>Rejoindre</button>
                </div>
            ) : (
                <div>
                    <h2>Dans la salle : {currentRoom}</h2>
                    <p>Participants (excluant vous) :</p>
                    {peersInRoom.length === 0 ? (
                        <p>Vous êtes le seul dans cette salle pour l'instant.</p>
                    ) : (
                        <ul>
                            {peersInRoom.map((peerId) => (
                                <li key={peerId}>
                                    {peerId}
                                </li>
                            ))}
                        </ul>
                    )}
                    <button onClick={leaveRoom} style={{ backgroundColor: 'red', color: 'white' }}>Quitter la Salle</button>
                </div>
            )}
        </div>
    );
}