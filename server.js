const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const app = express();
const port = 3000;

app.use(express.json());
app.use(cors());

// Servir archivos estáticos desde la carpeta public
app.use(express.static(path.join(__dirname, 'public')));

// Configurar base de datos SQLite (usando el archivo chatklax.db)
const db = new sqlite3.Database('chatklax.db', (err) => {
  if (err) {
    console.error('Error al abrir la base de datos:', err.message);
  } else {
    console.log('Base de datos conectada: chatklax.db');
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, displayName TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS friends (userId INTEGER, friendId INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, senderId INTEGER, receiverId INTEGER, content TEXT, timestamp TEXT)`);
});

// Credenciales del administrador
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD_HASH = '$2b$10$7m99SOiR1GY64zvARrXaguK919PzqJm5IeGOdrKfqXbuNBt.e9EkK'; // Contraseña: "admin123" (encriptada con bcrypt)

// Rutas de autenticación
app.post('/api/register', async (req, res) => {
  const { username, password, displayName } = req.body;
  console.log(`Intento de registro: ${username}`);
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (username, password, displayName) VALUES (?, ?, ?)`, [username, hashedPassword, displayName], function(err) {
      if (err) {
        console.error('Error al registrar usuario:', err.message);
        return res.status(400).json({ error: 'Usuario ya existe' });
      }
      console.log(`Usuario registrado con éxito: ${username}, id: ${this.lastID}`);
      res.json({ id: this.lastID, username, displayName });
    });
  } catch (error) {
    console.error('Error al registrar usuario:', error.message);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  console.log(`Intento de login: ${username}`);
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err) {
      console.error('Error al buscar usuario:', err.message);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    console.log(`Usuario autenticado: ${username}`);
    res.json({ id: user.id, username: user.username, displayName: user.displayName });
  });
});

// Ruta para limpiar la base de datos (protegida para el administrador)
app.post('/api/reset-db', async (req, res) => {
  const { adminUsername, adminPassword } = req.body;
  console.log('Solicitud para limpiar la base de datos recibida');

  // Verificar las credenciales del administrador
  if (adminUsername !== ADMIN_USERNAME || !(await bcrypt.compare(adminPassword, ADMIN_PASSWORD_HASH))) {
    console.log('Intento fallido de limpiar la base de datos: credenciales inválidas');
    return res.status(401).json({ error: 'Credenciales de administrador inválidas' });
  }

  console.log('Administrador autenticado, procediendo a limpiar la base de datos');
  db.serialize(() => {
    db.run(`DROP TABLE IF EXISTS users`, (err) => {
      if (err) {
        console.error('Error al eliminar tabla users:', err.message);
        return res.status(500).json({ error: 'Error al limpiar la base de datos' });
      }
      console.log('Tabla users eliminada');
    });
    db.run(`DROP TABLE IF EXISTS friends`, (err) => {
      if (err) {
        console.error('Error al eliminar tabla friends:', err.message);
        return res.status(500).json({ error: 'Error al limpiar la base de datos' });
      }
      console.log('Tabla friends eliminada');
    });
    db.run(`DROP TABLE IF EXISTS messages`, (err) => {
      if (err) {
        console.error('Error al eliminar tabla messages:', err.message);
        return res.status(500).json({ error: 'Error al limpiar la base de datos' });
      }
      console.log('Tabla messages eliminada');
    });
    // Recrear las tablas
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, displayName TEXT)`, (err) => {
      if (err) {
        console.error('Error al recrear tabla users:', err.message);
        return res.status(500).json({ error: 'Error al limpiar la base de datos' });
      }
      console.log('Tabla users recreada');
    });
    db.run(`CREATE TABLE IF NOT EXISTS friends (userId INTEGER, friendId INTEGER)`, (err) => {
      if (err) {
        console.error('Error al recrear tabla friends:', err.message);
        return res.status(500).json({ error: 'Error al limpiar la base de datos' });
      }
      console.log('Tabla friends recreada');
    });
    db.run(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, senderId INTEGER, receiverId INTEGER, content TEXT, timestamp TEXT)`, (err) => {
      if (err) {
        console.error('Error al recrear tabla messages:', err.message);
        return res.status(500).json({ error: 'Error al limpiar la base de datos' });
      }
      console.log('Tabla messages recreada');
      res.status(200).json({ success: true, message: 'Base de datos limpiada con éxito' });
    });
  });
});

// Rutas de amigos
app.get('/api/friends/:userId', (req, res) => {
  const { userId } = req.params;
  console.log(`Obteniendo amigos para userId: ${userId}`);
  db.all(`SELECT u.* FROM users u JOIN friends f ON u.id = f.friendId WHERE f.userId = ?`, [userId], (err, friends) => {
    if (err) {
      console.error('Error al obtener amigos:', err.message);
      return res.status(500).json({ error: 'Error al obtener amigos' });
    }
    res.json(friends);
  });
});

app.get('/api/users', (req, res) => {
  const { query, userId } = req.query;
  console.log(`Buscando usuarios con query: ${query}, excluyendo userId: ${userId}`);
  db.all(`SELECT * FROM users WHERE username LIKE ? AND id != ?`, [`%${query}%`, userId], (err, users) => {
    if (err) {
      console.error('Error al buscar usuarios:', err.message);
      return res.status(500).json({ error: 'Error al buscar usuarios' });
    }
    res.json(users);
  });
});

app.post('/api/friends', (req, res) => {
  const { userId, friendId } = req.body;
  console.log(`Agregando amigo: userId=${userId}, friendId=${friendId}`);
  db.run(`INSERT INTO friends (userId, friendId) VALUES (?, ?)`, [userId, friendId], (err) => {
    if (err) {
      console.error('Error al agregar amigo:', err.message);
      return res.status(500).json({ error: 'Error al agregar amigo' });
    }
    db.run(`INSERT INTO friends (userId, friendId) VALUES (?, ?)`, [friendId, userId], (err) => {
      if (err) {
        console.error('Error al agregar amigo mutuo:', err.message);
        return res.status(500).json({ error: 'Error al agregar amigo mutuo' });
      }
      res.status(200).json({ success: true });
    });
  });
});

// Rutas de mensajes
app.get('/api/messages', (req, res) => {
  const { userId, friendId } = req.query;
  console.log(`Obteniendo mensajes entre userId=${userId} y friendId=${friendId}`);
  db.all(
    `SELECT m.*, u.username as sender FROM messages m JOIN users u ON m.senderId = u.id 
    WHERE (m.senderId = ? AND m.receiverId = ?) OR (m.senderId = ? AND m.receiverId = ?) 
    ORDER BY m.timestamp`,
    [userId, friendId, friendId, userId],
    (err, messages) => {
      if (err) {
        console.error('Error al obtener mensajes:', err.message);
        return res.status(500).json({ error: 'Error al obtener mensajes' });
      }
      res.json(messages);
    }
  );
});

app.post('/api/messages', (req, res) => {
  const { senderId, receiverId, content } = req.body;
  const timestamp = new Date().toISOString();
  console.log(`Enviando mensaje de senderId=${senderId} a receiverId=${receiverId}: ${content}`);
  db.run(
    `INSERT INTO messages (senderId, receiverId, content, timestamp) VALUES (?, ?, ?, ?)`,
    [senderId, receiverId, content, timestamp],
    function(err) {
      if (err) {
        console.error('Error al enviar mensaje:', err.message);
        return res.status(500).json({ error: 'Error al enviar mensaje' });
      }
      const message = { id: this.lastID, senderId, receiverId, content, timestamp, sender: '' };
      db.get(`SELECT username FROM users WHERE id = ?`, [senderId], (err, user) => {
        if (err) {
          console.error('Error al obtener nombre de usuario:', err.message);
          return res.status(500).json({ error: 'Error al obtener nombre de usuario' });
        }
        message.sender = user.username;
        console.log(`Notificando a clientes: ${JSON.stringify(message)}`);
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'message', message }));
          }
        });
        res.json(message);
      });
    }
  );
});

// Configurar WebSocket
const server = app.listen(port, () => console.log(`Servidor corriendo en http://localhost:${port}`));
const wss = new WebSocket.Server({ server });
wss.on('connection', (ws) => {
  console.log('Cliente WebSocket conectado');
  ws.on('message', (data) => {
    const message = JSON.parse(data);
    if (message.type === 'auth') {
      ws.userId = message.userId;
      console.log(`Usuario autenticado en WebSocket: userId=${ws.userId}`);
    }
  });
  ws.on('close', () => {
    console.log('Cliente WebSocket desconectado');
  });
});