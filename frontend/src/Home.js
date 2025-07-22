import { useEffect } from 'react';
import {useNavigate} from 'react-router-dom';
import logo from './logo.png';
import './App.css';

function Home() {
    const navigate = useNavigate();

    useEffect(() => {
      document.body.classList.add('homepage');
      document.documentElement.classList.add('homepage'); 

      return () => {
        document.body.classList.remove('homepage');
        document.documentElement.classList.remove('homepage');
      };
    }, []);
    const createRoom = () => {
        const roomId = Math.random().toString(36).substring(2,8);
        navigate(`/room/${roomId}`);
    }
    return (
    <div className="main-wrapper">
      <div className="skync-header">
        <img src={logo} alt="Skync Logo" style={{ width: '170px', height: '170px', marginTop: '10px'}} />
        <h1 style={{ fontSize: '5rem', margin: 0 }}>Skync</h1>
      </div>

      <div className="app-container">
        <h1>A Collaborative Whiteboard</h1>
        <p>Draw, share, and collaborate in real-time.</p>
        <button onClick={createRoom}>Create a Room</button>
        <footer>© 2025 Angus Sun</footer>
      </div>
    </div>
    );
}

export default Home;
