import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';

type User = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  provider?: string;
};

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

const serverUrl = 'http://localhost:4000';

export default function App() {
  const [authMode, setAuthMode] = useState<'google' | 'phone'>('google');
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [googleName, setGoogleName] = useState('');
  const [googleEmail, setGoogleEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [demoOtp, setDemoOtp] = useState('');
  const [error, setError] = useState('');
  const [callState, setCallState] = useState('Idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  const fetchUsers = async () => {
    const response = await fetch(`${serverUrl}/api/users`);
    const data = await response.json();
    setUsers(data.filter((item: User) => item.name !== user?.name));
  };

  const fetchConversation = async (contactName: string) => {
    if (!user) return;
    const response = await fetch(`${serverUrl}/api/messages/${encodeURIComponent(user.name)}/${encodeURIComponent(contactName)}`);
    const data = await response.json();
    setMessages(data);
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('contactwave-user');
    if (!storedUser) return;
    try {
      const parsed = JSON.parse(storedUser) as User;
      setUser(parsed);
    } catch {
      localStorage.removeItem('contactwave-user');
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    localStorage.setItem('contactwave-user', JSON.stringify(user));
    fetchUsers();
  }, [user]);

  useEffect(() => {
    if (!user || !selectedContact) return;
    fetchConversation(selectedContact.name);
  }, [selectedContact, user]);

  useEffect(() => {
    if (!user) return;
    const newSocket = io(serverUrl);

    newSocket.on('connect', () => {
      newSocket.emit('register', user);
    });

    newSocket.on('receive-message', (message: ChatMessage) => {
      setMessages((prev) => {
        const exists = prev.some((item) => item.id === message.id);
        if (exists) return prev;
        return [...prev, message];
      });
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
      } catch (err) {
        console.error('ICE candidate error', err);
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

  useEffect(() => {
    if (!localStream || !localVideoRef.current) return;
    localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (!remoteStream || !remoteVideoRef.current) return;
    remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

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
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
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

  const startVideoCall = async () => {
    if (!selectedContact || !socket || !user) return;
    const remoteUserName = selectedContact.name;
    const pc = await createPeerConnection(remoteUserName);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit('start-call', { from: user.name, to: remoteUserName });
    socket.emit('offer', { from: user.name, to: remoteUserName, offer: pc.localDescription });
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

  const handleGoogleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const response = await fetch(`${serverUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: googleName, email: googleEmail }),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.message || 'Google sign in failed.');
      return;
    }

    setUser(data.user);
  };

  const requestPhoneOtp = async () => {
    setError('');
    const response = await fetch(`${serverUrl}/api/auth/phone/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, name: 'Phone User' }),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.message || 'Failed to send OTP.');
      return;
    }

    setOtpSent(true);
    setDemoOtp(data.demoCode || '123456');
  };

  const verifyPhone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const response = await fetch(`${serverUrl}/api/auth/phone/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp, name: 'Phone User' }),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.message || 'Phone verification failed.');
      return;
    }

    setUser(data.user);
    setOtp('');
    setOtpSent(false);
    setDemoOtp('');
  };

  const sendMessage = () => {
    if (!selectedContact || !socket || !user || !text.trim()) return;

    const payload = {
      from: user.name,
      to: selectedContact.name,
      text: text.trim(),
    };

    socket.emit('send-message', payload);
    const optimisticMessage: ChatMessage = {
      id: `${Date.now()}`,
      from: user.name,
      to: selectedContact.name,
      text: text.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMessage]);
    setText('');
  };

  const contactList = useMemo<Contact[]>(() => {
    return users.map((userItem) => ({
      id: Number(userItem.id || Date.now()) || 1,
      name: userItem.name,
      status: 'Online',
      avatar: userItem.name.charAt(0).toUpperCase(),
    }));
  }, [users]);

  useEffect(() => {
    if (!selectedContact && contactList[0]) {
      setSelectedContact(contactList[0]);
    }
  }, [contactList, selectedContact]);

  const visibleMessages = useMemo(() => {
    if (!selectedContact || !user) return [];
    return messages.filter(
      (message) =>
        (message.from === user.name && message.to === selectedContact.name) ||
        (message.from === selectedContact.name && message.to === user.name),
    );
  }, [messages, selectedContact, user]);

  const logout = () => {
    setUser(null);
    setMessages([]);
    setSelectedContact(null);
    localStorage.removeItem('contactwave-user');
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
            <button type="button" className={authMode === 'google' ? 'active' : ''} onClick={() => setAuthMode('google')}>
              Google
            </button>
            <button type="button" className={authMode === 'phone' ? 'active' : ''} onClick={() => setAuthMode('phone')}>
              Phone
            </button>
          </div>

          {authMode === 'google' ? (
            <form className="auth-form" onSubmit={handleGoogleSubmit}>
              <label>
                Name
                <input value={googleName} onChange={(event) => setGoogleName(event.target.value)} placeholder="Your name" required />
              </label>
              <label>
                Email
                <input type="email" value={googleEmail} onChange={(event) => setGoogleEmail(event.target.value)} placeholder="you@example.com" required />
              </label>
              <button type="submit">Continue with Google</button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={verifyPhone}>
              <label>
                Phone number
                <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+15550000000" required />
              </label>
              <button type="button" className="secondary-action" onClick={requestPhoneOtp}>Send OTP</button>

              {otpSent && (
                <div className="otp-box">
                  <span>Demo OTP: {demoOtp || '123456'}</span>
                </div>
              )}

              <label>
                Verification code
                <input value={otp} onChange={(event) => setOtp(event.target.value)} maxLength={6} placeholder="123456" />
              </label>

              <button type="submit">Verify and continue</button>
            </form>
          )}

          {error && <p className="auth-error">{error}</p>}
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
          {contactList.map((contact) => (
            <button key={contact.name} className={`contact-item ${selectedContact?.name === contact.name ? 'active' : ''}`} onClick={() => setSelectedContact(contact)}>
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
                <div key={message.id} className={`message ${message.from === user.name ? 'self' : 'other'}`}>
                  <strong>{message.from}</strong>
                  <p>{message.text}</p>
                  <small>{new Date(message.timestamp).toLocaleTimeString()}</small>
                </div>
              ))}
            </div>

            <div className="composer">
              <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Type a message..." onKeyDown={(event) => { if (event.key === 'Enter') sendMessage(); }} />
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
