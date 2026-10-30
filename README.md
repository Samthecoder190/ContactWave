# ContactWave

ContactWave is a real-time communication app starter with:
- Google or phone-based sign-in flow
- real-time messaging with Socket.IO
- webcam and microphone calling via WebRTC
- contact list and in-app presence status

## Tech stack
- Frontend: React + TypeScript + Vite
- Backend: Express + Socket.IO
- Real-time calls: WebRTC
- Auth: ready for Google OAuth / phone OTP integration in a demo-friendly flow

## Prerequisites
- Node.js 18+
- npm

## Local setup

1. Install root dependencies:
   ```bash
   npm install
   ```

2. Install app dependencies:
   ```bash
   npm --prefix server install
   npm --prefix client install
   ```

3. Start the server:
   ```bash
   npm --prefix server run dev
   ```

4. Start the frontend in another terminal:
   ```bash
   npm --prefix client run dev -- --host 0.0.0.0
   ```

5. Open the app in the browser:
   - http://localhost:5173

## Demo auth flow

This starter includes a demo-friendly authentication flow:
- Google sign-in: accepts a name and email and creates a signed-in session
- Phone sign-in: sends a demo OTP (123456) and verifies it before login

For production use, replace the demo endpoints with real Google OAuth and Twilio / Firebase phone auth.

## Real-time features
- text chat across users connected through Socket.IO
- presence updates
- call negotiation using WebRTC offer/answer and ICE candidates

## Notes
This repo is intentionally structured as a working MVP foundation for a messaging app. It’s built to be extended with:
- user accounts and persistence
- database storage
- push notifications
- encrypted end-to-end messaging
- production-grade call signaling
