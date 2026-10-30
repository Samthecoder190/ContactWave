# ContactWave

ContactWave is a lightweight communication app starter built for:
- texting contacts from a contact list
- initiating webcam and microphone calls
- real-time messaging with a simple socket-based backend

## Stack
- Frontend: React + TypeScript + Vite
- Backend: Express + Socket.IO
- Real-time calling: browser WebRTC

## Prerequisites
- Node.js 18+
- npm

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the app:
   ```bash
   npm run dev
   ```

3. Open the frontend in your browser:
   - http://localhost:5173

The backend runs on:
- http://localhost:4000

## Features included
- contact list
- direct messaging
- online presence messaging
- webcam + microphone call initiation
- browser-based peer-to-peer signaling using Socket.IO

## Notes
This project is intentionally built as a starter app. It demonstrates the core flow for chat and video calling and can be expanded with authentication, persistent storage, and a production-grade call setup.
