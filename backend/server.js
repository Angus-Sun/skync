const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }, 
});

const PORT = 3001;
const rooms = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join-room', (roomId) => {
    socket.join(roomId);

    //initialize room 
    if (!rooms[roomId]) {
      rooms[roomId] = {
        strokes: [],    
        elements: [],
        selections: new Map()    
      };
    }

    //send both strokes and elements when user joins so they can see previously drawn stuff
    socket.emit('load-room-data', { 
      strokes: rooms[roomId].strokes,
      elements: rooms[roomId].elements 
    });

    console.log(`User ${socket.id} joined room ${roomId}`);
  });

  //coordinates of existing stroke are replaced server-side and emitted to all clients
  socket.on('move-stroke', ({ roomId, strokeId, stroke }) => {
    if (!rooms[roomId]) return;
    const idx = rooms[roomId].strokes.findIndex(s => s.id === strokeId);
    //if stroke exists
    if (idx !== -1) {
      const existing = rooms[roomId].strokes[idx];
      rooms[roomId].strokes[idx] = { 
        id: existing.id,
        ownerId: existing.ownerId,
        stroke
      };
      //emits to everyone except the sender (to prevent lag)
      socket.to(roomId).emit('move-stroke', {
        strokeId,
        stroke,
        ownerId: existing.ownerId
      });
    }
  });

  socket.on('drawing', (data) => {
    if (!data || !data.roomId) return;

    const { roomId, strokeId, x1, y1, colour, tool, brushSize } = data;

    //makes sure room exists
    if (!rooms[roomId]) {
      rooms[roomId] = { strokes: [], elements: [] };
    }
    //create the stroke container to store details of the stroke live for live updates of drawing
    let stroke = rooms[roomId].strokes.find((s) => s.id === strokeId);
    if (!stroke) {
      stroke = { id: strokeId, stroke: [], ownerId: socket.id };
      rooms[roomId].strokes.push(stroke);
    }
    //adds new point to update stroke
    stroke.stroke.push({ x: x1, y: y1, colour, tool, brushSize });
    //broadcast stroke to entire room
    io.to(roomId).emit('drawing', { ...data, ownerId: socket.id });
  });
  //removes stroke user undid and emits to room
  socket.on('undo', ({ roomId, strokeId }) => {
    if (!roomId || !strokeId) return;
    if (!rooms[roomId]) return;

    rooms[roomId].strokes = rooms[roomId].strokes.filter((s) => s.id !== strokeId);

    io.to(roomId).emit('undo', { strokeId });
  });

  socket.on('layer-change', ({ roomId, strokes }) => {
    //update the stored strokes order
    if (rooms[roomId]) {
      rooms[roomId].strokes = strokes;
    }
    socket.to(roomId).emit('layer-change', { strokes });
  });

  socket.on('duplicate-stroke', ({ roomId, originalStrokeId, duplicatedStroke }) => {
    //add duplicated stroke to room data
    if (rooms[roomId]) {
      rooms[roomId].strokes.push(duplicatedStroke);
    }
    socket.to(roomId).emit('duplicate-stroke', { duplicatedStroke });
  });

  socket.on('delete-stroke', ({ roomId, strokeId }) => {
    //remove from room data
    if (rooms[roomId]) {
      rooms[roomId].strokes = rooms[roomId].strokes.filter(s => s.id !== strokeId);
    }
    socket.to(roomId).emit('delete-stroke', { strokeId });
  });

  socket.on('restore-stroke', ({ roomId, stroke }) => {
    //add restored stroke back to room data
    if (rooms[roomId]) {
      rooms[roomId].strokes.push(stroke);
    }
    socket.to(roomId).emit('restore-stroke', { stroke });
  });
  socket.on('stroke-completed', ({ roomId, strokeId }) => {
    //find the completed stroke from your server's stroke storage
    const completedStroke = rooms[roomId]?.strokes?.find(s => s.id === strokeId);
    
    if (completedStroke) {
      //emit to all clients in the room INCLUDING the sender
      io.to(roomId).emit('stroke-completed', { 
        strokeId, 
        stroke: completedStroke 
      });
    } else {
      //just emit the strokeId if stroke data isn't available
      io.to(roomId).emit('stroke-completed', { strokeId });
    }
  });
  socket.on('change-stroke-color', ({ roomId, strokeId, stroke }) => {
    if (rooms[roomId] && rooms[roomId].strokes) {
      const strokeIndex = rooms[roomId].strokes.findIndex(s => s.id === strokeId);
      if (strokeIndex !== -1) {
        rooms[roomId].strokes[strokeIndex].stroke = stroke;
      }
    }
    socket.to(roomId).emit('change-stroke-color', { strokeId, stroke });
  });

  socket.on('redo', ({ roomId, stroke }) => {
    if (!roomId || !stroke) return;
    if (!rooms[roomId]) {
      rooms[roomId] = { strokes: [], elements: [] };
    }

    rooms[roomId].strokes.push(stroke);

    io.to(roomId).emit('redo', { stroke });
  });

  //fixed element handling for images/text
  socket.on('add-element', ({ roomId, element }) => {
    //initialize room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = { strokes: [], elements: [] };
    }

    //save element to room data
    rooms[roomId].elements.push(element);

    //broadcast to all other clients in the room
    socket.to(roomId).emit('add-element', { element });
  });

  socket.on('move-element', ({ roomId, elementId, element }) => {
    //update in room data
    if (rooms[roomId] && rooms[roomId].elements) {
      const index = rooms[roomId].elements.findIndex(e => e.id === elementId);
      if (index !== -1) {
        rooms[roomId].elements[index] = element;
      }
    }

    //broadcast element movement to other clients
    socket.to(roomId).emit('move-element', { elementId, element });
  });

  //add handlers for element deletion/modification
  socket.on('delete-element', ({ roomId, elementId }) => {
    if (rooms[roomId] && rooms[roomId].elements) {
      rooms[roomId].elements = rooms[roomId].elements.filter(e => e.id !== elementId);
    }
    socket.to(roomId).emit('delete-element', { elementId });
  });

  socket.on('update-element', ({ roomId, elementId, element }) => {
    if (rooms[roomId] && rooms[roomId].elements) {
      const index = rooms[roomId].elements.findIndex(e => e.id === elementId);
      if (index !== -1) {
        rooms[roomId].elements[index] = element;
      }
    }
    socket.to(roomId).emit('update-element', { elementId, element });
  });
  socket.on('select-element', ({ roomId, elementId }) => {
    socket.to(roomId).emit('user-selected', { 
      userId: socket.id, 
      elementId 
    });
  });

  socket.on('deselect-element', ({ roomId, elementId }) => {
    socket.to(roomId).emit('user-deselected', { 
      userId: socket.id 
    });
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    socket.rooms.forEach(roomId => {
      if (roomId !== socket.id) {
        socket.to(roomId).emit('user-deselected', {
          userId: socket.id
        })
      }
    })
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});