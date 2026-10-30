import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

type Contact = {
  id: number;
  name: string;
  status: string;
  avatar: string;
};

type Message = {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: string;
};

const API_BASE = 'http://localhost:4000';

export default function App() {
  const [username, setUsername] = useState('Sam');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState('');
  const [socketReady, setSocketReady] = useState(false);
  const [incomingCall, setIncomingCall] = useState<string | null>(null);
  const [isCallActive, setIsCallActive] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isCalling, setIsCalling] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const socket = io(API_BASE, {
      transports: ['websocket'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketReady(true);
      socket.emit('register', username);
    });

    socket.on('receive-message', (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on('incoming-call', ({ from }) => {
      setIncomingCall(from);
    });

    socket.on('incoming-offer', async ({ from, offer }) => {
      setIncomingCall(from);
      pendingOfferRef.current = offer;
    });

    socket.on('incoming-answer', async ({ from, answer }) => {
      if (!pcRef.current) return;

      try {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        setIsCallActive(true);
      } catch (error) {
        console.error('Error setting remote description:', error);
      }
    });

    socket.on('incoming-ice-candidate', async ({ from, candidate }) => {
      if (!pcRef.current) return;

      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    });

    socket.on('user-status', ({ username: name, online }) => {
      setContacts((prev) =>
        prev.map((contact) =>
          contact.name === name
            ? { ...contact, status: online ? 'Online' : 'Offline' }
            : contact
        )
      );
    });

    fetch(`${API_BASE}/api/contacts`)
      .then((res) => res.json())
      .then((data) => setContacts(data))
      .catch((err) => console.error('Failed to fetch contacts:', err));

    return () => {
      socket.disconnect();
    };
  }, [username]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.muted = true;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const createPeerConnection = async () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    pc.onicecandidate = (event) => {
      if (!event.candidate || !selectedContact) return;
      const socket = socketRef.current;
      if (!socket) return;

      socket.emit('ice-candidate', {
        from: username,
        to: selectedContact.name,
        candidate: event.candidate,
      });
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      setRemoteStream(stream);
    };

    pcRef.current = pc;
    return pc;
  };

  const startLocalMedia = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    localStreamRef.current = stream;
    setLocalStream(stream);

    const pc = await createPeerConnection();
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    return pc;
  };

  const callUser = async (contact: Contact) => {
    if (!socketRef.current) return;

    try {
      setSelectedContact(contact);
      setIsCalling(true);

      const pc = await startLocalMedia();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socketRef.current.emit('offer', {
        from: username,
        to: contact.name,
        offer: pc.localDescription,
      });
    } catch (error) {
      console.error('Unable to start call:', error);
      alert('Could not access webcam or microphone.');
    }
  };

  const acceptIncomingCall = async () => {
    if (!incomingCall || !socketRef.current) return;

    try {
      const contact = contacts.find((c) => c.name === incomingCall);
      if (contact) setSelectedContact(contact);

      const pc = await startLocalMedia();

      if (pendingOfferRef.current) {
        await pc.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socketRef.current.emit('answer', {
          from: username,
          to: incomingCall,
          answer: pc.localDescription,
        });
      }
    } catch (error) {
      console.error('Error accepting call:', error);
    }
  };

  const endCall = () => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    setLocalStream(null);
    setRemoteStream(null);
    setIncomingCall(null);
    setIsCallActive(false);
    setIsCalling(false);
  };

  const handleSendMessage = () => {
    if (!selectedContact || !messageText.trim() || !socketRef.current) return;

    const payload: Message = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      from: username,
      to: selectedContact.name,
      text: messageText.trim(),
      timestamp: new Date().toISOString(),
    };

    socketRef.current.emit('send-message', {
      from: username,
      to: selectedContact.name,
      text: payload.text,
    });

    setMessages((prev) => [...prev, payload]);
    setMessageText('');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="logo">C</div>
          <div>
            <h2>ContactWave</h2>
            <p>Messaging + Video</p>
          </div>
        </div>

        <div className="user-box">
          <label>Display name</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Your name"
          />
          <button
            className="primary"
            onClick={() => {
              if (socketRef.current) {
                socketRef.current.emit('register', username);
              }
            }}
          >
            {socketReady ? 'Refresh profile' : 'Connect'}
          </button>
        </div>

        <div className="contact-list">
          {contacts.map((contact) => (
            <button
              key={contact.id}
              className={`contact-card ${selectedContact?.id === contact.id ? 'active' : ''}`}
              onClick={() => setSelectedContact(contact)}
            >
              <div className="avatar">{contact.avatar}</div>
              <div className="contact-meta">
                <strong>{contact.name}</strong>
                <span>{contact.status}</span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="chat-area">
        {selectedContact ? (
          <>
            <div className="chat-header">
              <div>
                <h3>{selectedContact.name}</h3>
                <span>{selectedContact.status}</span>
              </div>

              <div className="call-actions">
                <button className="primary" onClick={() => callUser(selectedContact)}>
                  {isCalling ? 'Calling...' : 'Start call'}
                </button>
                <button className="secondary" onClick={endCall}>
                  End call
                </button>
              </div>
            </div>

            {incomingCall && (
              <div className="incoming-call-banner">
                <span>Incoming call from {incomingCall}</span>
                <button className="primary" onClick={acceptIncomingCall}>
                  Accept
                </button>
                <button className="secondary" onClick={endCall}>
                  Decline
                </button>
              </div>
            )}

            <div className="video-grid">
              <div className="video-card">
                <video ref={localVideoRef} autoPlay playsInline muted />
                <span>Me</span>
              </div>

              <div className="video-card">
                <video ref={remoteVideoRef} autoPlay playsInline />
                <span>{selectedContact.name}</span>
              </div>
            </div>

            <div className="messages">
              {messages
                .filter(
                  (msg) =>
                    (msg.from === username && msg.to === selectedContact.name) ||
                    (msg.to === username && msg.from === selectedContact.name)
                )
                .map((msg) => (
                  <div
                    key={msg.id}
                    className={`message-row ${msg.from === username ? 'mine' : ''}`}
                  >
                    <div className="message-bubble">
                      <span>{msg.text}</span>
                      <small>{new Date(msg.timestamp).toLocaleTimeString()}</small>
                    </div>
                  </div>
                ))}
            </div>

            <div className="composer">
              <input
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder={`Message ${selectedContact.name}...`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSendMessage();
                }}
              />
              <button className="primary" onClick={handleSendMessage}>
                Send
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h3>Select a contact</h3>
            <p>Choose someone from the left panel to start chatting.</p>
          </div>
        )}
      </main>
    </div>
  );
}
