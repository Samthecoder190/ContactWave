# ContactWave

ContactWave is a real-time messaging and video-calling app prototype.

## Features
- Google sign-in and phone OTP sign-in
- contact list and user directory
- live real-time messaging with Socket.IO
- WebRTC webcam + microphone call flow
- local JSON persistence for users and messages

## Stack
- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + Socket.IO
- Data: JSON file store for a dev-ready MVP

## Prerequisites
- Node.js 18+
- npm

## Local development

1. Install dependencies:
   ```bash
   npm install
   npm --prefix server install
   npm --prefix client install
   ```

2. Start the backend:
   ```bash
   npm --prefix server run dev
   ```

3. Start the frontend:
   ```bash
   npm --prefix client run dev -- --host 0.0.0.0
   ```

4. Open the app:
   - http://localhost:5173

## Demo auth
- Google sign-in: enter a name and email.
- Phone sign-in: enter a phone number, receive a demo OTP (`123456`), then verify it.

## Notes
This is a working MVP designed to run locally with no external services. For production, replace the JSON storage with PostgreSQL/Supabase and use a real OAuth / OTP provider.
