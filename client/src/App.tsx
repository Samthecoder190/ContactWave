import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';

type Contact = {
  id: number;
  name: string;
  status: string;
  avatar: string;
};

type ChatMessage = {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: string;
};

type AuthUser = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  provider?: string;
};

const serverUrl = 'http://localhost:4000';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [callState, setCallState] = useState('Idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [authType, setAuthType] = useState<'google' | 'phone'>('google');
  const [googleName, setGoogleName] = useState('');
  const [googleEmail, setGoogleEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [demoOtp, setDemoOtp] = useState('');
  const [authError, setAuthError] = useState('');

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('contactwave-user');
    if (!storedUser) return;

    try {
      const parsed = JSON.parse(storedUser) as AuthUser;
      setUser(parsed);
    } catch {
      localStorage.removeItem('contactwave-user');
    }
  }, []);

  useEffect(() => {
    const getContacts = async () => {
      const response = await fetch(`${serverUrl}/api/contacts`);
      const data = await response.json();
      setContacts(data);
      if (data[0]) setSelectedContact(data[0]);
    };

    getContacts();
  }, []);

  useEffect(() => {
    if (!localStream || !localVideoRef.current) return;
    localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (!remoteStream || !remoteVideoRef.current) return;
    remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (!user) return;

    localStorage.setItem('contactwave-user', JSON.stringify(user));
    const newSocket = io(serverUrl);

    newSocket.on('connect', () => {
      newSocket.emit('register', user);
    });

    newSocket.on('receive-message', (message: ChatMessage) => {
      setMessages((prev) => [...prev, message]);
    });

    newSocket.on('incoming-call', ({ from }) => {
      setCallState(`Incoming call from ${from}`);
    });

    newSocket.on('incoming-offer', async ({ from, offer }) => {
      await handleIncomingOffer(from, offer);
    });

    newSocket.on('incoming-answer', async ({ from, answer }) => {
      if (!peerConnectionRef.current) return;
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      setCallState(`Connected with ${from}`);
    });

    newSocket.on('incoming-ice-candidate', async ({ from, candidate }) => {
      if (!peerConnectionRef.current || !candidate) return;
      try {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Error adding ICE candidate', error);
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [user]);

  const handleIncomingOffer = async (from: string, offer: RTCSessionDescriptionInit) => {
    const pc = await createPeerConnection(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    if (socket && user) {
      socket.emit('answer', {
        from: user.name,
        to: from,
        answer: pc.localDescription,
      });
    }

    setCallState(`Connected with ${from}`);
  };

  const ensureLocalStream = async () => {
    if (localStream) return localStream;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    setLocalStream(stream);
    return stream;
  };

  const createPeerConnection = async (remoteUserName: string) => {
    const stream = await ensureLocalStream();
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    peerConnectionRef.current = pc;

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && socket && user) {
        socket.emit('ice-candidate', {
          from: user.name,
          to: remoteUserName,
          candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      const [remoteMediaStream] = event.streams;
      setRemoteStream(remoteMediaStream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setCallState(`Connected with ${remoteUserName}`);
      }
    };

    return pc;
  };

  const handleGoogleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError('');

    const response = await fetch(`${serverUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: googleName || 'Google User',
        email: googleEmail,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      setAuthError(data.message || 'Google sign in failed.');
      return;
    }

    setUser(data.user);
  };

  const handlePhoneRequestOtp = async () => {
    setAuthError('');
    const response = await fetch(`${serverUrl}/api/auth/phone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phoneNumber, name: 'Phone User' }),
    });

    const data = await response.json();
    if (!response.ok) {
      setAuthError(data.message || 'Unable to send OTP.');
      return;
    }

    setOtpSent(true);
    setDemoOtp(data.demoCode || '123456');
  };

  const handlePhoneAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError('');

    const response = await fetch(`${serverUrl}/api/auth/phone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: phoneNumber,
        otp,
        name: 'Phone User',
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      setAuthError(data.message || 'Phone login failed.');
      return;
    }

    setUser(data.user);
    setOtpSent(false);
    setOtp('');
    setDemoOtp('');
  };

  const startVideoCall = async () => {
    if (!selectedContact || !socket || !user) return;

    const remoteUserName = selectedContact.name;
    const pc = await createPeerConnection(remoteUserName);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit('start-call', {
      from: user.name,
      to: remoteUserName,
    });

    socket.emit('offer', {
      from: user.name,
      to: remoteUserName,
      offer: pc.localDescription,
    });

    setCallState(`Calling ${remoteUserName}...`);
  };

  const leaveCall = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }

    setRemoteStream(null);
    setCallState('Idle');
  };

  const sendMessage = () => {
    if (!selectedContact || !socket || !user || !draft.trim()) return;

    const message: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      from: user.name,
      to: selectedContact.name,
      text: draft.trim(),
      timestamp: new Date().toISOString(),
    };

    socket.emit('send-message', {
      from: message.from,
      to: selectedContact.name,
      text: message.text,
    });

    setMessages((prev) => [...prev, message]);
    setDraft('');
  };

  const visibleMessages = useMemo(() => {
    if (!selectedContact || !user) return [];

    return messages.filter(
      (message) =>
        message.to === selectedContact.name ||
        message.from === selectedContact.name ||
        message.from === user.name,
    );
  }, [messages, selectedContact, user]);

  const logout = () => {
    setUser(null);
    localStorage.removeItem('contactwave-user');
    setSelectedContact(null);
    setMessages([]);
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }
  };

  if (!user) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="brand-block">
            <span className="logo">C</span>
            <h1>ContactWave</h1>
          </div>

          <div className="auth-toggle">
            <button
              type="button"
              className={authType === 'google' ? 'active' : ''}
              onClick={() => setAuthType('google')}
            >
              Google
            </button>
            <button
              type="button"
              className={authType === 'phone' ? 'active' : ''}
              onClick={() => setAuthType('phone')}
            >
              Phone
            </button>
          </div>

          {authType === 'google' ? (
            <form className="auth-form" onSubmit={handleGoogleAuth}>
              <label>
                Name
                <input
                  value={googleName}
                  onChange={(event) => setGoogleName(event.target.value)}
                  placeholder="Your name"
                />
              </label>

              <label>
                Google email
                <input
                  type="email"
                  value={googleEmail}
                  onChange={(event) => setGoogleEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </label>

              <button type="submit">Continue with Google</button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={handlePhoneAuth}>
              <label>
                Phone number
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  placeholder="+1234567890"
                  required
                />
              </label>

              <button type="button" className="secondary-action" onClick={handlePhoneRequestOtp}>
                Send OTP
              </button>

              {otpSent && (
                <div className="otp-box">
                  <span>Demo OTP: {demoOtp || '123456'}</span>
                </div>
              )}

              <label>
                Verification code
                <input
                  value={otp}
                  maxLength={6}
                  onChange={(event) => setOtp(event.target.value)}
                  placeholder="123456"
                />
              </label>

              <button type="submit">Verify and continue</button>
            </form>
          )}

          {authError && <p className="auth-error">{authError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <span className="logo">C</span>
          <h1>ContactWave</h1>
        </div>

        <div className="user-chip">
          <div className="avatar">{user.name.charAt(0).toUpperCase()}</div>
          <div>
            <strong>{user.name}</strong>
            <small>{user.provider === 'google' ? 'Google account' : 'Phone account'}</small>
          </div>
        </div>

        <button className="logout-button" onClick={logout}>Log out</button>

        <div className="contact-list">
          {contacts.map((contact) => (
            <button
              key={contact.id}
              className={`contact-item ${selectedContact?.id === contact.id ? 'active' : ''}`}
              onClick={() => setSelectedContact(contact)}
            >
              <span className="avatar">{contact.avatar}</span>
              <span className="contact-main">
                <strong>{contact.name}</strong>
                <small>{contact.status}</small>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="chat-panel">
        {selectedContact ? (
          <>
            <header className="chat-header">
              <div>
                <h2>{selectedContact.name}</h2>
                <span>{selectedContact.status}</span>
              </div>
              <div className="call-meta">{callState}</div>
            </header>

            <div className="video-panel">
              <video ref={localVideoRef} autoPlay muted playsInline />
              <video ref={remoteVideoRef} autoPlay playsInline />
            </div>

            <div className="call-actions">
              <button className="primary" onClick={startVideoCall}>Start call</button>
              <button className="secondary" onClick={leaveCall}>Leave call</button>
            </div>

            <div className="message-list">
              {visibleMessages.map((message) => (
                <div
                  key={message.id}
                  className={`message ${message.from === user.name ? 'self' : 'other'}`}
                >
                  <strong>{message.from}</strong>
                  <p>{message.text}</p>
                  <small>{new Date(message.timestamp).toLocaleTimeString()}</small>
                </div>
              ))}
            </div>

            <div className="composer">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') sendMessage();
                }}
                placeholder="Type a message..."
              />
              <button onClick={sendMessage}>Send</button>
            </div>
          </>
        ) : (
          <div className="empty-state">Choose a contact to begin.</div>
        )}
      </main>
    </div>
  );
}
