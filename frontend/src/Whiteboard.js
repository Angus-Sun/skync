import { useEffect, useRef, useState } from 'react';
import { FaUndoAlt, FaRedoAlt } from 'react-icons/fa';
import { useParams } from 'react-router-dom';
import io from 'socket.io-client';
import Toolbar from './Toolbar';
import './Whiteboard.css';
import './Toolbar.css';

function Whiteboard() {
  const {roomId} = useParams();
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const socketRef = useRef(null);
  const imageCache = useRef(new Map());

  const BOUNDING_BOX_PADDING = 20;

  const [otherUsersSelections, setOtherUsersSelections] = useState(new Map());
  const [isDrawing, setIsDrawing] = useState(false);

  const[tool, setTool] = useState('none');
  const [brushSize, setBrushSize] = useState(3);
  const [colour, setColour] = useState('#000000');
  
  const dragOffset = useRef({x:0, y:0});

  const actionHistory = useRef([]);
  const redoHistory = useRef([]);
  const lastX = useRef(0);
  const lastY = useRef(0);

  const currentStroke = useRef([]);
  const currentStrokeId = useRef(null);
  const [allStrokes, setAllStrokes] = useState([]);
  const myStrokes = useRef([]);
  const undoneStrokes = useRef([]);
  const [selectedStrokeId, setSelectedStrokeId] = useState(null);
  const [isDraggingStroke, setIsDraggingStroke] = useState(false);
  const originalStrokeBeforeDrag = useRef(null);
  const [hoveredStrokeId, setHoveredStrokeId] = useState(null);
  const [liveStrokes, setLiveStrokes] = useState(new Map());

  const [resizing, setResizing] = useState(false);
  const resizingCorner = useRef(null);
  const FONTSIZE = 24;
  const MAX_IMAGE_HEIGHT = 800;
  const MAX_IMAGE_WIDTH = 800;
  
  //very unique random number generated based on time to generate stroke ID 
  const generateStrokeId = () =>
    `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  //sends socket.io event to server to signify to others that the selected element the client previously 
  //selected in the client's room has been deselected
  const handleDeselect = () => {
    if (selectedStrokeId) {
      socketRef.current.emit('deselect-element', {roomId, elementId: selectedStrokeId});
    }
    setSelectedStrokeId(null);
  }

  const handleImageUpload = (imageDataUrl) => {
    const img = new Image();

    img.onload = () => {
      const canvas = canvasRef.current;
      //position and size of canvas relative to viewport
      const rect = canvas.getBoundingClientRect();

      const viewportCenterX = window.innerWidth/2;
      const viewportCenterY = window.innerHeight/2;

      //canvas coordinates for center of viewport
      const canvasX = viewportCenterX - rect.left;
      const canvasY = viewportCenterY - rect.top;

      // Calculate constrained dimensions
      let width = img.width;
      let height = img.height;
      
      // Calculate scale factor to fit within max dimensions while maintaining aspect ratio
      const scaleX = MAX_IMAGE_WIDTH / width;
      const scaleY = MAX_IMAGE_HEIGHT / height;
      const scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down
      
      // Apply the scale
      width *= scale;
      height *= scale;

      const imageElement = {
        id: generateStrokeId(),
        type: 'image',
        x: canvasX,
        y: canvasY,
        width: width,  // Use constrained width
        height: height, // Use constrained height
        src: imageDataUrl,
        ownerId: socketRef.current.id
      }

      //adds image to allstrokes which stores all elements in th room
      //also adds to mystrokes for later undo/redo purposes 
      setAllStrokes(prev => [...prev, imageElement]);
      myStrokes.current.push(imageElement.id);

      //auto-select the image and switch to select tool
      setSelectedStrokeId(imageElement.id);
      setTool('none');

      socketRef.current.emit('add-element', {
        roomId,
        element: imageElement
      });

      //Add action to action history
      actionHistory.current.push({
        type: 'addElement',
        element: imageElement
      });
      redoHistory.current = [];
    }
    img.src = imageDataUrl;
  }

  const handleTextAdd = () => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    const viewportCenterX = window.innerWidth / 2;
    const viewportCenterY = window.innerHeight / 2;
    
    const canvasX = viewportCenterX - rect.left;
    const canvasY = viewportCenterY - rect.top;

    const text = prompt('Enter text') || 'Text';

    //Measure text dimensions
    const ctx = ctxRef.current;
    ctx.font = `${FONTSIZE}px Arial`;
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = FONTSIZE;

    const textElement = {
      id: generateStrokeId(),
      type: 'text',
      x: canvasX,
      y: canvasY,
      text: text,
      fontSize: FONTSIZE,
      colour, colour,
      width: textWidth,
      height: textHeight,
      originalWidth: textWidth,
      originalHeight: textHeight,
      ownerId: socketRef.current.id
    }
    //updates allstrokes so the user sees all strokes present in the room including the one the text they just added
    setAllStrokes(prev => [...prev, textElement]);
    //updates mystrokes for redo/undo management
    myStrokes.current.push(textElement.id);

    setSelectedStrokeId(textElement.id);
    setTool('none');

    socketRef.current.emit('add-element', {
      roomId,
      element: textElement
    });

    actionHistory.current.push({
      type: 'addElement',
      element: textElement
    });
    redoHistory.current = [];
  }

  const getBoundingBox = (element) => {
    if (element.type === 'image') {
      //calculates minimum dimensions of rectangle that can encapsulate the image
      return {
        minX: element.x,
        minY: element.y,
        maxX: element.x + element.width,
        maxY: element.y + element.height
      }
    } else if (element.type === 'text') {
      //uses text width and height if already available
      //otherwise it calculates using text length and fontsize (assuming average character width is 0.6x the font size)
      const width = element.width || (element.text.length * (element.originalFontSize || element.fontSize) * 0.6);
      const height = element.height || (element.originalFontSize || element.fontSize);

      return {
        minX: element.x,
        minY: element.y - height,
        maxX: element.x + width,
        maxY: element.y
      };
    } else if (element.stroke && element.stroke.length > 0) {
      //for regular strokes
      //collects all x and y positions from the stroke's points
      const xs = element.stroke.map(p => p.x);
      const ys = element.stroke.map(p => p.y);
      //finds the min/max of all x/y positions to get the rectangle that surrounds the stroke
      return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys)
      };
    }
  }

  const hitTestBoundingBox = (x, y) => {
    //priority 1: If something is selected, check if we're within its bounding box first
    if (selectedStrokeId) {
      const selectedElement = allStrokes.find(s => s.id === selectedStrokeId);
      if (selectedElement) {
        const { minX, minY, maxX, maxY } = getBoundingBox(selectedElement);
        if (
          x >= minX - BOUNDING_BOX_PADDING &&
          x <= maxX + BOUNDING_BOX_PADDING &&
          y >= minY - BOUNDING_BOX_PADDING &&
          y <= maxY + BOUNDING_BOX_PADDING
        ) {
          //we're within the selected element's bounding box, only return this element
          return selectedElement.id;
        }
      }
    }

    //priority 2: Check all elements from top to bottom (reverse order since last drawn = on top)
    for (let i = allStrokes.length - 1; i >= 0; i--) {
      const element = allStrokes[i];
      const { minX, minY, maxX, maxY } = getBoundingBox(element);
      if (
        x >= minX - BOUNDING_BOX_PADDING &&
        x <= maxX + BOUNDING_BOX_PADDING &&
        y >= minY - BOUNDING_BOX_PADDING &&
        y <= maxY + BOUNDING_BOX_PADDING
      ) {
        return element.id;
      }
    }
    return null;
  }

  //disables right clicking on web page (so that the user can pan using right click)
  useEffect(() => {
    const preventContextMenu = (e) => e.preventDefault();
    document.addEventListener('contextmenu', preventContextMenu);
    return () => document.removeEventListener('contextmenu', preventContextMenu);
  }, []);

  useEffect(() => {
    //connects to socket.io server
    socketRef.current = io('https://skync-backend.onrender.com');

    //join the room specified by roomId when connected
    socketRef.current.on('connect', () => {
      socketRef.current.emit('join-room', roomId);
    })

    socketRef.current.on('delete-element', ({ elementId }) => {
      setAllStrokes(prev => prev.filter(s => s.id !== elementId));
      
      // Clear selection if the deleted element was selected
      if (selectedStrokeId === elementId) {
        setSelectedStrokeId(null);
      }
      
      // Remove from hover state if it was hovered
      if (hoveredStrokeId === elementId) {
        setHoveredStrokeId(null);
      }
    });
    //listens for when another user selects an element
    socketRef.current.on('user-selected', ({userId, elementId}) => {
      if (userId !== socketRef.current.id) {
        //updates state with other users' selections
        setOtherUsersSelections(prev => new Map(prev).set(userId, elementId));
      }
    })
    
    //lisetns for when another users deselects an element
    socketRef.current.on('user-deselected', ({userId}) => {
      setOtherUsersSelections(prev => {
        const newMap = new Map(prev);
        //remove user's selection
        newMap.delete(userId);
        return newMap;
      })
    })

    //adds restored stroke from server to local state
    socketRef.current.on('restore-stroke', ({stroke}) => {
      setAllStrokes(prev => {
        if (prev.find(s => s.id === stroke.id)) {
          return prev;
        }
        return [...prev, stroke];
      })
    })
    //update a specific stroke's data (e.g. moved or changed)
    socketRef.current.on('move-stroke', ({ strokeId, stroke }) => {
      setAllStrokes(prev =>
        prev.map(s => (s.id === strokeId ? { ...s, stroke } : s))
      );
    });

    //handle movement of other elements (images or text)
    socketRef.current.on('move-element', ({ elementId, element }) => {
      //loops through all current elements
      //if id matches elementId replace with new element, otherwise leave it unchanged
      setAllStrokes(prev =>
        prev.map(s => (s.id === elementId ? element : s))
      );
    });

    //add a new element (image or text) from other users
    socketRef.current.on('add-element', ({ element }) => {
      setAllStrokes(prev => {
        //ignore if element already exists
        if (prev.find(e => e.id === element.id)) return prev;
        
        //for images, preload into cache to optimize rendering
        if (element.type === 'image') {
          const img = new Image();
          img.src = element.src;
          imageCache.current.set(element.src, img);
        }
        
        return [...prev, element];
      });
    });

    //replace all strokes on layer changes (e.g., reorder layers)
    socketRef.current.on('layer-change', ({ strokes }) => {
      setAllStrokes(strokes || []);
    });

    //add a duplicated stroke sent by other clients
    socketRef.current.on('duplicate-stroke', ({ duplicatedStroke }) => {
      setAllStrokes(prev => {
        //avoid adding duplicate strokes
        if (prev.find(s => s.id === duplicatedStroke.id)) return prev;
        return [...prev, duplicatedStroke];
      });
    });

    //remove a stroke deleted by other clients
    socketRef.current.on('delete-stroke', ({ strokeId }) => {
      setAllStrokes(prev => prev.filter(s => s.id !== strokeId));
      //if the deleted stroke was selected locally, clear that selection
      setSelectedStrokeId(prev => prev === strokeId ? null : prev);
    });

    //load strokes from server when joining room or refreshing
    socketRef.current.on('load-strokes', ({ strokes }) => {
      setAllStrokes(strokes || []);
      myStrokes.current = [];
      undoneStrokes.current = [];
      //track strokes owned by this client
      if (socketRef.current.id && strokes) {
        myStrokes.current = strokes
          .filter((s) => s.ownerId === socketRef.current.id)
          .map((s) => s.id);
      }
    });

    //load full room data (strokes + other elements like images/text)
    socketRef.current.on('load-room-data', ({ strokes, elements }) => {
      //combine strokes and elements for unified state
      const allItems = [
        ...(strokes || []),
        ...(elements || [])
      ];
      
      setAllStrokes(allItems);
      myStrokes.current = [];
      undoneStrokes.current = [];
      
      //preload images into cache for smooth rendering
      elements?.forEach(element => {
        if (element.type === 'image') {
          const img = new Image();
          img.src = element.src;
          imageCache.current.set(element.src, img);
        }
      });
      
      //track items owned by this client
      if (socketRef.current.id && allItems) {
        myStrokes.current = allItems
          .filter((s) => s.ownerId === socketRef.current.id)
          .map((s) => s.id);
      }
    });

    //update stroke colors when changed by other clients
    socketRef.current.on('change-stroke-color', ({ strokeId, stroke }) => {
      setAllStrokes(prev => {
        const updated = prev.map(s => (s.id === strokeId ? { ...s, stroke } : s));
        //return new array reference for rerendering
        return [...updated];
      });
    });

    //handle live drawing data from other clients for real-time updates
   socketRef.current.on('drawing', (data) => {
      if (!data) return;
      const { strokeId, x0, y0, x1, y1, colour, tool, brushSize, ownerId } = data;
      
      //only process drawing events from other users
      if (ownerId !== socketRef.current.id) {
        //update live strokes for real-time display of other users' drawing 
        setLiveStrokes(prev => {
          const newLiveStrokes = new Map(prev);
          const existingStroke = newLiveStrokes.get(strokeId);
          
          if (existingStroke) {
            existingStroke.push({ x: x1, y: y1, colour, tool, brushSize });
          } else {
            newLiveStrokes.set(strokeId, [
              { x: x0, y: y0, colour, tool, brushSize },
              { x: x1, y: y1, colour, tool, brushSize }
            ]);
          }
          
          return newLiveStrokes;
        });

        //also update main strokes state for other users
        setAllStrokes((prev) => {
          const newStrokes = [...prev];
          const existing = newStrokes.find((s) => s.id === strokeId);
          if (existing) {
            existing.stroke.push({ x: x1, y: y1, colour, tool, brushSize });
          } else {
            newStrokes.push({
              id: strokeId,
              stroke: [
                { x: x0, y: y0, colour, tool, brushSize },
                { x: x1, y: y1, colour, tool, brushSize },
              ],
              ownerId,
            });
          }
          return newStrokes;
        });
      }
    });
    //when a stroke is completed, remove it from live strokes
    socketRef.current.on('stroke-completed', ({ strokeId }) => {
      setLiveStrokes(prev => {
        const newLiveStrokes = new Map(prev);
        newLiveStrokes.delete(strokeId);
        return newLiveStrokes;
      });
    });

    //handle undo action from other clients
    socketRef.current.on('undo', ({ strokeId }) => {
      setAllStrokes((prev) => {
        const strokeToUndo = prev.find((s) => s.id === strokeId);
        if (!strokeToUndo) return prev;
        if (strokeToUndo.ownerId === socketRef.current.id) {
          //move stroke from myStrokes to undoneStrokes for this client
          myStrokes.current = myStrokes.current.filter((id) => id !== strokeId);
          undoneStrokes.current.push(strokeToUndo);
        }
        return prev.filter((s) => s.id !== strokeId);
      });
    });

    //handle redo action from other clients
    socketRef.current.on('redo', ({ stroke }) => {
      if (!stroke) return;
      setAllStrokes((prev) => {
        if (prev.find((s) => s.id === stroke.id)) {
          return prev;
        }
        if (stroke.ownerId === socketRef.current.id) {
          //move stroke back from undoneStrokes to myStrokes
          myStrokes.current.push(stroke.id);
          undoneStrokes.current = undoneStrokes.current.filter((s) => s.id !== stroke.id);
        }
        return [...prev, stroke];
      });
    });

    //disconnect socket when user disconnects or roomId changes
    return () => {
      socketRef.current.disconnect();
    };
  }, [roomId]);

  //sets up canvas and marker settings
  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = 4000;
    canvas.height = 4000;
    canvas.style.background = 'white';
    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctxRef.current = ctx;
  }, []);
  
  //updates canvas whenever a change is made
  useEffect(() => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    //render all elements
    const renderElements = () => {
      for (const element of allStrokes) {
        if (element.type === 'image') {
          // Use cached image or create new one
          let img = imageCache.current.get(element.src);
          if (!img) {
            img = new Image();
            img.src = element.src;
            imageCache.current.set(element.src, img);
          }
          
          //only draw if image is loaded
          if (img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, element.x, element.y, element.width, element.height);
            
            //draw selection border if selected
            if (selectedStrokeId === element.id) {
              ctx.strokeStyle = '#00f';
              ctx.lineWidth = 2;
              ctx.strokeRect(element.x, element.y, element.width, element.height);
              
              //draw resize handles
              const handleSize = 8;
              const handles = [
                [element.x, element.y],
                [element.x + element.width, element.y],
                [element.x, element.y + element.height],
                [element.x + element.width, element.y + element.height]
              ];
              
              handles.forEach(([x, y]) => {
                ctx.fillStyle = 'blue';
                ctx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
              });
            }
          } else if (!img.complete) {
            //image is still loading, set up onload handler and re-render when ready
            img.onload = () => {
              //force re-render when image loads
              setAllStrokes(prev => [...prev]);
            };
            img.onerror = () => {
              console.error('Failed to load image:', element.src);
            };
          }
        } else if (element.type === 'text') {
          //ensure original dimensions stored (for undo/redo purposes)
          if (!element.originalWidth || !element.originalHeight || !element.originalFontSize) {
            const tempCtx = ctxRef.current;
            const originalFontSize = element.originalFontSize || element.fontSize;
            tempCtx.font = `${originalFontSize}px Arial`;
            const metrics = tempCtx.measureText(element.text);
            
            //update element with original dimensions if missing
            element.originalWidth = element.originalWidth || metrics.width;
            element.originalHeight = element.originalHeight || originalFontSize;
            element.originalFontSize = element.originalFontSize || originalFontSize;
          }
          
          //calculate current scale
          const originalWidth = element.originalWidth;
          const originalHeight = element.originalHeight;
          const originalFontSize = element.originalFontSize;
          
          const currentWidth = element.width || originalWidth;
          const currentHeight = element.height || originalHeight;
          
          //calculate scale factors
          const scaleX = currentWidth / originalWidth;
          const scaleY = currentHeight / originalHeight;
          
          //use average scale for better text rendering
          const scale = Math.sqrt(scaleX * scaleY);
          const scaledFontSize = Math.max(8, originalFontSize * scale);
          
          ctx.fillStyle = element.colour;
          ctx.font = `${scaledFontSize}px Arial`;
          ctx.fillText(element.text, element.x, element.y);
          
          //draw selection border if selected
          if (selectedStrokeId === element.id) {
            ctx.strokeStyle = '#00f';
            ctx.lineWidth = 2;
            ctx.strokeRect(element.x, element.y - currentHeight, currentWidth, currentHeight);
            
            const textLeft = element.x;
            const textRight = element.x + currentWidth;
            const textTop = element.y - currentHeight;  // Top of text box
            const textBottom = element.y; // Baseline of text
            //draw resize handles for text
            const handleSize = 8;
            const handles = [
              [textLeft, textTop], // top-left
              [textRight, textTop], // top-right
              [textLeft, textBottom], // bottom-left
              [textRight, textBottom] // bottom-right
            ];

            handles.forEach(([x, y]) => {
              ctx.fillStyle = 'blue';
              ctx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
            });
          }
        } else {
          const { stroke } = element;
          if (stroke) {
            for (let i = 1; i < stroke.length; i++) {
              const p1 = stroke[i - 1];
              const p2 = stroke[i];
              ctx.strokeStyle = p1.colour;
              ctx.lineWidth = p1.brushSize;
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.stroke();
            }
          }
        }
      }
      liveStrokes.forEach((stroke, strokeId) => {
        if (stroke && stroke.length > 1) {
          for (let i = 1; i < stroke.length; i++) {
            const p1 = stroke[i - 1];
            const p2 = stroke[i];
            ctx.strokeStyle = p1.colour;
            ctx.lineWidth = p1.brushSize;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      });
      //handle hover effect for strokes 
      if (hoveredStrokeId && tool === 'none') {
        const stroke = allStrokes.find(s => s.id === hoveredStrokeId);
        if (stroke && stroke.stroke) { 
          for (let i = 1; i < stroke.stroke.length; i++) {
            const p1 = stroke.stroke[i - 1];
            const p2 = stroke.stroke[i];
            ctx.strokeStyle = 'rgba(0, 0, 255, 0.4)';
            ctx.lineWidth = 5;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }

      //handle selection border for strokes (images and text handle their own borders above)
      if (selectedStrokeId) {
        const selected = allStrokes.find(s => s.id === selectedStrokeId);
        if (selected && selected.stroke) { // Only for stroke elements
          const { minX, minY, maxX, maxY } = getBoundingBox(selected);
          ctx.strokeStyle = '#00f';
          ctx.lineWidth = 1;
          ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);

          const handleSize = 8;
          [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]].forEach(([x, y]) => {
            ctx.fillStyle = 'blue';
            ctx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
          });
        }
      }
    };

    renderElements();
  }, [allStrokes, liveStrokes, hoveredStrokeId, selectedStrokeId, tool]);

    const startDrawing = ({nativeEvent}) => {
      const {offsetX, offsetY} = nativeEvent;
      //don't do anything if user right clicks (used for panning)
      if (nativeEvent.button === 2) {
        return;
      }
      if (tool === 'text') {
        return;
      }
      //resizing logic
      if (tool === 'none' && selectedStrokeId) {
        //iterates through allstrokes array to search for element that is selected
        const element = allStrokes.find(s => s.id === selectedStrokeId);
        if (element) {
          let handles = {};

        if (element.type === 'image') {
          //stores position of top-left, top-right, bottom-left, bottom-right handles 
          handles = {
            tl: [element.x, element.y],
            tr: [element.x + element.width, element.y],
            bl: [element.x, element.y+element.height],
            br: [element.x + element.width, element.y + element.height]
          }
        } else if (element.type === 'text') {
          const currentWidth = element.width || element.originalWidth;
          const currentHeight = element.height || element.originalHeight;
          const textTop = element.y - currentHeight;
          const textBottom = element.y;

          handles = {
            tl: [element.x, textTop],
            tr: [element.x + currentWidth, textTop],
            bl: [element.x, textBottom],
            br: [element.x + currentWidth, textBottom]
          };
        } else if (element.stroke) {
          //uses bounding box calculations for strokes
          const {minX, minY, maxX, maxY} = getBoundingBox(element);
          handles = {
            tl: [minX, minY], tr: [maxX, minY],
            bl: [minX, maxY], br: [maxX, maxY]
          }
        }
        //looping through resize handles
        for (const [corner, [hx, hy]] of Object.entries(handles)) {
          //checks if mouse is within 8 pixels of the handle
          if (Math.abs(hx - offsetX) < 8 && Math.abs(hy - offsetY) < 8) {
            resizingCorner.current = corner;
            //creates copy of current element before resizing for undos
            //uses json.parse(json.stringify(element)) as this is a deep copy so changes to the copy don't affect the original
            originalStrokeBeforeDrag.current = JSON.parse(JSON.stringify(element));
            setResizing(true);
            return;
            }
          }
        }
      }
      //selection and dragging logic
      if (tool === 'none') {
        const boundingStrokeId = hitTestBoundingBox(offsetX, offsetY);

        //check if someone else already has selected this
        const isSelectedByOther = Array.from(otherUsersSelections.values()).includes(boundingStrokeId);

        if (boundingStrokeId && !isSelectedByOther) {
          //deselect previous element if there's any only if no one else selected
          if (selectedStrokeId) {
            socketRef.current.emit('deselect-element', {roomId, elementId: selectedStrokeId});
          }

          setSelectedStrokeId(boundingStrokeId);
          socketRef.current.emit('select-element', {roomId, elementId: boundingStrokeId});

          const element = allStrokes.find(s => s.id === boundingStrokeId);
          //deep copy of original stroke before drag for undos
          originalStrokeBeforeDrag.current = JSON.parse(JSON.stringify(element));
          
          if (element.type === 'image' || element.type === 'text') {
            //calculates how far the click point is from the top-left corner
            //makes sure when dragging the element moves with the mouse instead of jumping to it
            dragOffset.current = {x: offsetX - element.x, y: offsetY - element.y};
          } else if (element.stroke && element.stroke.length > 0) {
            //uses first point as reference for strokes as they arent always going to be perfectly 4 sided like images/text
            const firstPoint = element.stroke[0];
            dragOffset.current = {x: offsetX - firstPoint.x, y: offsetY - firstPoint.y};
          }
          setIsDraggingStroke(true);
        } else if (boundingStrokeId && isSelectedByOther) {
          //if selected by someone else, don't select
          alert("already selected by another person in this room!")
          setSelectedStrokeId(null);
        } else if (selectedStrokeId){
          socketRef.current.emit('deselect-element', {roomId, elementId: selectedStrokeId});
          setSelectedStrokeId(null);
        }
        return;
      }
      
      setIsDrawing(true);
      //stores current mouse position as last known coordinates
      lastX.current = offsetX;
      lastY.current = offsetY;
      currentStrokeId.current = generateStrokeId();
      const size = brushSize;
      //stores data of current position, colour, tool, and thickness of stroke
      currentStroke.current = [{x: offsetX, y: offsetY, colour, tool, brushSize: size}];
      //clears redo history
      undoneStrokes.current = [];
    }

    const draw = ({nativeEvent}) => {
      const {offsetX, offsetY} = nativeEvent;

      if (tool === 'none' && resizing && selectedStrokeId && resizingCorner.current) {
        const original = originalStrokeBeforeDrag.current;
        const element = allStrokes.find(s => s.id === selectedStrokeId);

        //add safety check original for element existence
        if (!element || !original) {
          return;
        }
        
        if (element.type === 'image') {
          //handle image resizing
          const corner = resizingCorner.current;
          let newWidth = element.width;
          let newHeight = element.height;
          let newX = element.x;
          let newY = element.y;

          //proportional scaling for images
          const aspectRatio = element.width / element.height;
          //check which corner is being dragged and calculate new proportional dimensions
          if (corner === 'br') {
            //calculate how far the mouse moved from the bottom-right corner
            const deltaX = offsetX - (element.x + element.width);
            const deltaY = offsetY - (element.y + element.height);
            //used to see how much to change the image by to maintain aspect ratio
            const scaleFactor = Math.max(deltaX / element.width, deltaY / element.height);

            newWidth = Math.max(20, element.width * (1 + scaleFactor));

            newHeight = newWidth / aspectRatio;
          } else if (corner === 'tr') {
            //top right
            const deltaX = offsetX - (element.x + element.width);
            const deltaY = (element.y) - offsetY;
            const scaleFactor = Math.max(deltaX / element.width, deltaY / element.height);

            newWidth = Math.max(20, element.width * (1 + scaleFactor));
            newHeight = newWidth / aspectRatio;
            newY = element.y + element.height - newHeight;

          } else if (corner === 'bl') {
            //bottom left
            const deltaX = element.x - offsetX;
            const deltaY = offsetY - (element.y + element.height);
            const scaleFactor = Math.max(deltaX / element.width, deltaY / element.height);

            newWidth = Math.max(20, element.width * (1 + scaleFactor));
            newHeight = newWidth / aspectRatio;
            newX = element.x + element.width - newWidth;

          } else if (corner === 'tl') {
            //top left
            const deltaX = element.x - offsetX;
            const deltaY = element.y - offsetY;
            const scaleFactor = Math.max(deltaX / element.width, deltaY / element.height);

            newWidth = Math.max(20, element.width * (1 + scaleFactor));
            newHeight = newWidth / aspectRatio;
            newX = element.x + element.width - newWidth;
            newY = element.y + element.height - newHeight;
          }
          const updatedElement = {
            ...element,
            x: newX,
            y: newY,
            width: newWidth,
            height: newHeight
          }

          setAllStrokes(prev => {
            //makes sure allstrokes isnt empty 
            if (!prev || !Array.isArray(prev)) {
              return prev ||  [];
            }
            //updates the selectedstroke with the updates
            return prev.map(s =>
              s.id === selectedStrokeId ? updatedElement : s
            )
          })

          socketRef.current.emit('move-element', {
            roomId,
            elementId: selectedStrokeId,
            element: updatedElement
          })
        }
        if (element.type === 'text') {
          const corner = resizingCorner.current;

          const currentWidth = element.width || element.originalWidth;
          const currentHeight = element.height || element.originalHeight;

          const textLeft = element.x;
          const textRight = element.x + currentWidth;
          const textTop = element.y - currentHeight;
          const textBottom = element.y;

          let newWidth, newHeight, newX, newY;
          if (corner === 'br') {
            //determine new dimensions and position based on corner being dragged
            newWidth = Math.max(20, offsetX - textLeft);
            newHeight = Math.max(10, offsetY - textTop);
            newX = textLeft;
            newY = textTop + newHeight;
          } else if (corner === 'bl') {
            newWidth = Math.max(20, textRight - offsetX);
            newHeight = Math.max(10, offsetY - textTop);
            newX = textRight - newWidth;
            newY = textTop + newHeight;
          } else if (corner === 'tr') {
            // Top-right: calculate top edge directly
            const newTop = Math.min(offsetY, textBottom - 10); 
            newHeight = Math.max(10, textBottom - newTop);
            newWidth = Math.max(20, offsetX - textLeft);
            newX = textLeft;
            newY = textBottom; 
          } else if (corner === 'tl') {
            const newTop = Math.min(offsetY, textBottom - 10);
            newHeight = Math.max(10, textBottom - newTop);
            newWidth = Math.max(20, textRight - offsetX);
            newX = textRight - newWidth;
            newY = textBottom;
          }
          //get original width/height using stored values or calculate if missing
          const originalWidth = element.originalWidth || element.width || (element.text.length * element.fontSize * 0.6);
          const originalHeight = element.originalHeight || element.height || element.fontSize;

          //calculate how much its being scaled
          const scaleX = newWidth / originalWidth;
          const scaleY = newHeight / originalHeight;
          const scale = Math.max(scaleX, scaleY);

          const finalWidth = originalWidth * scale;
          const finalHeight = originalHeight * scale;
          //final position based on corner being dragged
          let finalX, finalY;
          if (corner === 'br') {
            finalX = textLeft;
            finalY = textTop + finalHeight;
          } else if (corner === 'bl') {
            finalX = textRight - finalWidth;
            finalY = textTop + finalHeight;
          } else if (corner === 'tr') {
            finalX = textLeft;
            finalY = textBottom;
          } else if (corner === 'tl') {
            finalX = textRight - finalWidth;
            finalY = textBottom;
          }
          //create new version of element with updates size/position
          const updatedElement = {
            //copy old element properties and replace what's needed
            ...element,
            x: finalX,
            y: finalY,
            width: finalWidth,
            height: finalHeight,
            originalWidth: element.originalWidth || originalWidth,
            originalHeight: element.originalHeight || originalHeight,
            originalFontSize: element.originalFontSize || element.fontSize,
          };
          //update strokes list with updated element 
          setAllStrokes(prev => {
            if (!prev || !Array.isArray(prev)) return prev || [];
            return prev.map(s =>
              s.id === selectedStrokeId ? updatedElement : s
            );
          });
          //sends update to server
          socketRef.current.emit('move-element', {
            roomId,
            elementId: selectedStrokeId,
            element: updatedElement,
          });
        } else if (element.stroke) {
          const bbox = getBoundingBox(original);
          const centerX = (bbox.minX + bbox.maxX) / 2;
          const centerY = (bbox.minY + bbox.maxY) / 2;
          //scale factor calculated based on how far offset is from the center
          const scale = Math.max(
            Math.abs(offsetX - centerX) / (bbox.maxX - centerX),
            Math.abs(offsetY - centerY) / (bbox.maxY - centerY)
          )
          //creates resized version using calculated scale factor
          const resizedStroke = original.stroke.map(p => ({
            ...p,
            x: centerX + (p.x-centerX) * scale,
            y: centerY + (p.y-centerY) * scale
          }));

          setAllStrokes(prev => {
            if (!prev || !Array.isArray(prev)) {
              return prev || [];
            }
            return prev.map(s =>
            s.id === selectedStrokeId ? {...s, stroke: resizedStroke} : s
            );
          });

          socketRef.current.emit('move-stroke', {
            roomId,
            strokeId: selectedStrokeId,
            stroke: resizedStroke
          });
        }
        return;
      }
    //check if mouse is hovering over any bounding box
    //makes stroke ID hovered if thats the case
    if (tool === 'none' && !isDraggingStroke && !resizing) {
      const hoveredId = hitTestBoundingBox(offsetX, offsetY);
      setHoveredStrokeId(hoveredId);
    }
    //calculate new position and update the stroke's position accordingly
    if (tool === 'none' && isDraggingStroke && selectedStrokeId) {
      const newX = offsetX - dragOffset.current.x;
      const newY = offsetY - dragOffset.current.y;
      //update allstrokes state with changed position
      setAllStrokes(prev => {
        // Add safety check for prev
        if (!prev || !Array.isArray(prev)) return prev || [];
        
        const updated = prev.map(element => {
          if (element.id !== selectedStrokeId) return element;

          if (element.type === 'image' || element.type === 'text') {
            const updatedElement = { ...element, x: newX, y: newY };
            
            socketRef.current.emit('move-element', {
              roomId,
              elementId: selectedStrokeId,
              element: updatedElement,
            });
            
            return updatedElement;
          } else if (element.stroke) {
            // Original stroke logic
            const firstPoint = element.stroke[0];
            const deltaX = newX - firstPoint.x;
            const deltaY = newY - firstPoint.y;

            const movedStroke = element.stroke.map(p => ({
              ...p,
              x: p.x + deltaX,
              y: p.y + deltaY,
            }));

            socketRef.current.emit('move-stroke', {
              roomId,
              strokeId: selectedStrokeId,
              stroke: movedStroke,
            });

            return { ...element, stroke: movedStroke };
          }
          return element;
        });

        return updated;
      });
    }
    //if right mouse button clicked or not currently drawing exit early
    if (nativeEvent.button === 2 || !isDrawing) return;
    if (!isDrawing) return;

    const ctx = ctxRef.current;
    if (!ctx) return;
    
    //draw immediately to canvas for smooth local feedback
    ctx.strokeStyle = colour;
    ctx.lineWidth = brushSize;
    ctx.beginPath();
    ctx.moveTo(lastX.current, lastY.current);
    ctx.lineTo(offsetX, offsetY);
    ctx.stroke();
    ctx.closePath();
    
    //add current data to ongoing stroke
    const size = brushSize;
    currentStroke.current.push({ x: offsetX, y: offsetY, colour, tool, brushSize: size });
    
    //update live strokes for consistent state management
    setLiveStrokes(prev => {
      const newLiveStrokes = new Map(prev);
      const existingStroke = newLiveStrokes.get(currentStrokeId.current);
      
      if (existingStroke) {
        existingStroke.push({ x: offsetX, y: offsetY, colour, tool, brushSize: size });
      } else {
        newLiveStrokes.set(currentStrokeId.current, [
          { x: lastX.current, y: lastY.current, colour, tool, brushSize: size },
          { x: offsetX, y: offsetY, colour, tool, brushSize: size }
        ]);
      }
      
      return newLiveStrokes;
    }); 
    
    //emit drawing event to server for other users
    socketRef.current.emit('drawing', {
      roomId,
      strokeId: currentStrokeId.current,
      x0: lastX.current,
      y0: lastY.current,
      x1: offsetX,
      y1: offsetY,
      colour,
      tool,
      brushSize: size,
      ownerId: socketRef.current.id,
    });

    lastX.current = offsetX;
    lastY.current = offsetY;
    }

    const stopDrawing = () => {
      //if currently resizing and there is an original stroke state saved
      if (resizing && selectedStrokeId && originalStrokeBeforeDrag.current) {
        //find resized element from all strokes
        const resizedElement = allStrokes.find(s => s.id === selectedStrokeId);
        //JSON stringifying to check if element is actually changed
        if (resizedElement && JSON.stringify(resizedElement) !== JSON.stringify(originalStrokeBeforeDrag.current)) {
          actionHistory.current.push({
            type: 'resize',
            elementId: selectedStrokeId,
            before: originalStrokeBeforeDrag.current,
            after: {...resizedElement} 
          });
          //clear redo history
          redoHistory.current = [];
        }
        setResizing(false);
        resizingCorner.current = null;
        return;
      }

      if (tool === 'none') {
        if (isDraggingStroke && selectedStrokeId && originalStrokeBeforeDrag.current) {
          //find moved element
          const movedElement = allStrokes.find(s => s.id === selectedStrokeId);
          if (movedElement && JSON.stringify(movedElement) !== JSON.stringify(originalStrokeBeforeDrag.current)) {
            actionHistory.current.push({
              type: 'move',
              elementId: selectedStrokeId, // Changed from strokeId to elementId for consistency
              before: originalStrokeBeforeDrag.current,
              after: { ...movedElement } 
            });
            redoHistory.current = [];
          }
        }
        setIsDraggingStroke(false);
        originalStrokeBeforeDrag.current = null;
        return;
      }

      //no action needed if not currently drawing
      if (!isDrawing) {
        return;
      }
      setIsDrawing(false);
      //add to strokes list if it has more than one point
      if (currentStroke.current.length > 1) {
        //create new stroke object with unique id and points
        const newStroke = {
          id: currentStrokeId.current,
          stroke: [...currentStroke.current],
          ownerId: socketRef.current.id,
        };
        //adds stroke to allstrokes and mystrokes (added to mystrokes for redo/undo functionality)
        setAllStrokes((prev) => [...prev, newStroke]);
        myStrokes.current.push(currentStrokeId.current);
        actionHistory.current.push({
          type: 'draw',
          stroke: newStroke,
        });
        redoHistory.current = [];

        socketRef.current.emit('stroke-completed', {
          roomId,
          strokeId: currentStrokeId.current
        });
      }
    };
    //moves selected stroke one layer up
    const handleMoveUp = () => {
      //do nothing if no stroke is selected
      if (!selectedStrokeId) {
        return;
      }
      
      setAllStrokes(prev => {
        //find index of selectedstroke in strokes array
        const currentIndex = prev.findIndex(s => s.id === selectedStrokeId);

        //if stroke not found or already at top no change is needed
        if (currentIndex === -1 || currentIndex === prev.length - 1) return prev;
        
        const newStrokes = [...prev];
        [newStrokes[currentIndex], newStrokes[currentIndex + 1]] = [newStrokes[currentIndex + 1], newStrokes[currentIndex]];

        socketRef.current.emit('layer-change', {
          roomId,
          strokes: newStrokes
        });

        actionHistory.current.push({
          type: 'layerChange',
          before: [...prev],
          after: [...newStrokes]
        });

        redoHistory.current = [];
        return newStrokes;
      });
    };

    const handleMoveDown = () => {
      if (!selectedStrokeId) return;
      
      setAllStrokes(prev => {
        const currentIndex = prev.findIndex(s => s.id === selectedStrokeId);
        if (currentIndex === -1 || currentIndex === 0) return prev;
        
        const newStrokes = [...prev];
        [newStrokes[currentIndex], newStrokes[currentIndex - 1]] = 
        [newStrokes[currentIndex - 1], newStrokes[currentIndex]];
        
        socketRef.current.emit('layer-change', {
          roomId,
          strokes: newStrokes
        });
        
        actionHistory.current.push({
          type: 'layerChange',
          before: [...prev],
          after: [...newStrokes]
        });
        redoHistory.current = [];
        
        return newStrokes;
      });
    }
    const handleDuplicate = () => {
      if (!selectedStrokeId) return;
      
      const selectedElement = allStrokes.find(s => s.id === selectedStrokeId);
      if (!selectedElement) return;
      
      const newElementId = generateStrokeId();
      const offsetX = 20;
      const offsetY = 20;
      
      let duplicatedElement;
      
      if (selectedElement.type === 'image' || selectedElement.type === 'text') {
        //handle image duplication
        duplicatedElement = {
          ...selectedElement,
          id: newElementId,
          x: selectedElement.x + offsetX,
          y: selectedElement.y + offsetY,
          ownerId: socketRef.current.id
        };
      } else if (selectedElement.stroke) {
        //handle stroke duplication (original logic)
        duplicatedElement = {
          ...selectedElement,
          id: newElementId,
          stroke: selectedElement.stroke.map(point => ({
            ...point,
            x: point.x + offsetX,
            y: point.y + offsetY
          })),
          ownerId: socketRef.current.id
        };
      } 
      
      //add to strokes/elements array
      setAllStrokes(prev => [...prev, duplicatedElement]);
      
      //update ownership tracking
      myStrokes.current.push(newElementId);
      
      //select the new duplicate
      setSelectedStrokeId(newElementId);
      
      //emit to other clients - use appropriate event based on element type
      if (duplicatedElement.type === 'image' || duplicatedElement.type === 'text') {
        socketRef.current.emit('add-element', {
          roomId,
          element: duplicatedElement
        });
      } else {
        socketRef.current.emit('duplicate-stroke', {
          roomId,
          originalStrokeId: selectedStrokeId,
          duplicatedStroke: duplicatedElement
        });
      }
      
      //add to action history for undo
      actionHistory.current.push({
        type: 'duplicate',
        elementId: newElementId, 
        element: duplicatedElement
      });
      redoHistory.current = [];
    }
    const handleDelete = () => {
      if (!selectedStrokeId) return;
      
      const elementToDelete = allStrokes.find(s => s.id === selectedStrokeId);
      if (!elementToDelete) return;
      
      // Remove from local state
      setAllStrokes(prev => prev.filter(s => s.id !== selectedStrokeId));
      
      // Update ownership tracking
      myStrokes.current = myStrokes.current.filter(id => id !== selectedStrokeId);
      
      // Clear selection
      setSelectedStrokeId(null);
      
      // Emit appropriate delete event based on element type
      if (elementToDelete.type === 'image' || elementToDelete.type === 'text') {
        // For images and text, emit delete-element event
        socketRef.current.emit('delete-element', {
          roomId,
          elementId: selectedStrokeId
        });
      } else {
        // For strokes, use the existing delete-stroke event
        socketRef.current.emit('delete-stroke', {
          roomId,
          strokeId: selectedStrokeId
        });
      }
      
      // Add to action history for undo
      actionHistory.current.push({
        type: 'delete',
        strokeId: selectedStrokeId,
        stroke: elementToDelete
      });
      redoHistory.current = [];
    }
    const handleSelectColourChange = (newColour) => {
      if (!selectedStrokeId) return;

      const selectedElement = allStrokes.find(s => s.id === selectedStrokeId);
      if (!selectedElement) return;

      // Store original element for undo functionality
      const originalElement = JSON.parse(JSON.stringify(selectedElement));

      let updatedElement;
      
      if (selectedElement.type === 'text') {
        // For text elements, update the colour property directly
        updatedElement = {
          ...selectedElement,
          colour: newColour
        };
        
        // Update local state
        setAllStrokes(prev =>
          prev.map(s => s.id === selectedStrokeId ? updatedElement : s)
        );

        // Emit to other clients - for text elements, send the whole element
        socketRef.current.emit('move-element', {
          roomId,
          elementId: selectedStrokeId,
          element: updatedElement,
        });
        
      } else if (selectedElement.stroke) {
        // For stroke elements, update each point's colour
        updatedElement = {
          ...selectedElement,
          stroke: selectedElement.stroke.map(point => ({
            ...point,
            colour: newColour  
          }))
        };
        
        // Update local state
        setAllStrokes(prev =>
          prev.map(s => s.id === selectedStrokeId ? updatedElement : s)
        );

        // Emit to other clients - for strokes, send the stroke array
        socketRef.current.emit('change-stroke-color', {
          roomId,
          strokeId: selectedStrokeId,
          stroke: updatedElement.stroke,
        });
      }

      // Add to action history for undo
      actionHistory.current.push({
        type: 'colorChange',
        strokeId: selectedStrokeId,
        before: originalElement,
        after: updatedElement
      });
      redoHistory.current = [];
    };
    const handleUndo = () => {
      const lastAction = actionHistory.current.pop();
      if (!lastAction) return;

      redoHistory.current.push(lastAction);

      if (lastAction.type === 'draw') {
        //goes through all strokes and keeps everything except for the undid stroke
        setAllStrokes(prev => prev.filter(s => s.id !== lastAction.stroke.id));
        socketRef.current.emit('undo', { roomId, strokeId: lastAction.stroke.id });
        
      } else if (lastAction.type === 'move') {
        //revert to original position - handle both stroke and element types
        setAllStrokes(prev =>
          prev.map(s =>
            s.id === lastAction.elementId ? lastAction.before : s
          )
        );
        
        //use appropriate emit based on element type
        const element = lastAction.before;
        if (element.type === 'image' || element.type === 'text') {
          socketRef.current.emit('move-element', {
            roomId,
            elementId: lastAction.elementId,
            element: lastAction.before,
          });
        } else if (element.stroke) {
          socketRef.current.emit('move-stroke', {
            roomId,
            strokeId: lastAction.elementId,
            stroke: lastAction.before.stroke,
          });
        }
        
      } else if (lastAction.type === 'resize') {
        //builds new array with same strokes as previous but replaces resized stroke with original size
        setAllStrokes(prev =>
          prev.map(s =>
            s.id === lastAction.elementId ? lastAction.before : s
          )
        );
        const element = lastAction.before;
        if (element.type === 'image' || element.type === 'text') {
          socketRef.current.emit('move-element', {
            roomId,
            elementId: lastAction.elementId,
            element: lastAction.before,
          });
        } else {
          socketRef.current.emit('move-stroke', {
            roomId,
            strokeId: lastAction.elementId,
            stroke: lastAction.before.stroke,
          });
        }
        
      } else if (lastAction.type === 'colorChange') {
        //revert color change
        setAllStrokes(prev =>
          prev.map(s =>
            s.id === lastAction.strokeId ? lastAction.before : s
          )
        );
        socketRef.current.emit('change-stroke-color', {
          roomId,
          strokeId: lastAction.strokeId,
          stroke: lastAction.before.stroke,
        });
        
      } else if (lastAction.type === 'layerChange') {
        //revert layer order
        setAllStrokes(lastAction.before);
        socketRef.current.emit('layer-change', {
          roomId,
          strokes: lastAction.before
        });
        
      } else if (lastAction.type === 'duplicate') {
        //remove the duplicated element
        setAllStrokes(prev => prev.filter(s => s.id !== lastAction.elementId));
        myStrokes.current = myStrokes.current.filter(id => id !== lastAction.elementId);
        setSelectedStrokeId(null);
        socketRef.current.emit('delete-stroke', {
          roomId,
          strokeId: lastAction.elementId
        });
      } else if (lastAction.type === 'delete') {
        //restore the deleted stroke
        setAllStrokes(prev => [...prev, lastAction.stroke]);
        if (lastAction.stroke.ownerId === socketRef.current.id) {
          myStrokes.current.push(lastAction.strokeId);
        }
        socketRef.current.emit('restore-stroke', {
          roomId,
          stroke: lastAction.stroke
        });
        
      } else if (lastAction.type === 'addElement') {
        setAllStrokes(prev => prev.filter(s => s.id !== lastAction.element.id));
        myStrokes.current = myStrokes.current.filter(id => id !== lastAction.element.id);
        setSelectedStrokeId(null);
        socketRef.current.emit('delete-stroke', {
          roomId,
          strokeId: lastAction.element.id
        });
      }
    };
    const handleRedo = () => {
      const action = redoHistory.current.pop();
      if (!action) return;

      actionHistory.current.push(action);

      if (action.type === 'draw') {
        setAllStrokes(prev => [...prev, action.stroke]);
        socketRef.current.emit('redo', { roomId, stroke: action.stroke });

      } else if (action.type === 'move') {
        setAllStrokes(prev =>
          prev.map(s =>
            s.id === action.elementId ? action.after : s
          )
        );
        
        const element = action.after;
        if (element.type === 'image' || element.type === 'text') {
          socketRef.current.emit('move-element', {
            roomId,
            elementId: action.elementId,
            element: action.after,
          });
        } else if (element.stroke) {
          socketRef.current.emit('move-stroke', {
            roomId,
            strokeId: action.elementId,
            stroke: action.after.stroke,
          });
        }

      } else if (action.type === 'remove') {
        setAllStrokes(prev =>
          prev.filter(s => s.id !== action.strokeId)
        );
        socketRef.current.emit('remove-stroke', {
          roomId,
          strokeId: action.strokeId,
        });
        
      } else if (action.type === 'resize') {
        setAllStrokes(prev =>
          prev.map(s =>
            s.id === action.elementId ? action.after : s
          )
        );

        const element = action.after;
        if (element.type === 'image' || element.type === 'text') {
          socketRef.current.emit('move-element', {
            roomId,
            elementId: action.elementId,
            element: action.after,
          });
        } else {
          socketRef.current.emit('move-stroke', {
            roomId,
            strokeId: action.elementId,
            stroke: action.after.stroke,
          });
        }
        
      } else if (action.type === 'colorChange') {
        setAllStrokes(prev =>
          prev.map(s =>
            s.id === action.strokeId ? action.after : s
          )
        );
        socketRef.current.emit('change-stroke-color', {
          roomId,
          strokeId: action.strokeId,
          stroke: action.after.stroke,
        });
        
      } else if (action.type === 'layerChange') {
        setAllStrokes(action.after);
        socketRef.current.emit('layer-change', {
          roomId,
          strokes: action.after
        });
      } else if (action.type === 'duplicate') {
        setAllStrokes(prev => [...prev, action.element]); 
        myStrokes.current.push(action.elementId); 
        setSelectedStrokeId(action.elementId);

        if (action.element.type === 'image' || action.element.type === 'text') {
          socketRef.current.emit('add-element', {
            roomId,
            element: action.element
          });
        } else {
          socketRef.current.emit('duplicate-stroke', {
            roomId,
            originalStrokeId: selectedStrokeId,
            duplicatedStroke: action.element
          });
        }
      } else if (action.type === 'delete') {
        setAllStrokes(prev => prev.filter(s => s.id !== action.strokeId));
        myStrokes.current = myStrokes.current.filter(id => id !== action.strokeId);
        setSelectedStrokeId(null);
        socketRef.current.emit('delete-stroke', {
          roomId,
          strokeId: action.strokeId
        });
      } else if (action.type === 'addElement') {
        setAllStrokes(prev => [...prev, action.element]);
        myStrokes.current.push(action.element.id);
        socketRef.current.emit('add-element', {
          roomId,
          element: action.element
        });
      }
    }

  useEffect(() => {
    const handleKeyDown = (event) => {
      // Prevent default behavior for our shortcuts
      if ((event.ctrlKey && event.key === 'z') || 
          (event.ctrlKey && event.key === 'y') || 
          event.key === 'Backspace') {
        
        // Only prevent default if we're not in an input field
        const activeElement = document.activeElement;
        const isInputField = activeElement && (
          activeElement.tagName === 'INPUT' || 
          activeElement.tagName === 'TEXTAREA' || 
          activeElement.contentEditable === 'true'
        );
        
        if (!isInputField) {
          event.preventDefault();
        }
      }

      // Handle Ctrl+Z (Undo)
      if (event.ctrlKey && event.key === 'z' && !event.shiftKey) {
        const activeElement = document.activeElement;
        const isInputField = activeElement && (
          activeElement.tagName === 'INPUT' || 
          activeElement.tagName === 'TEXTAREA' || 
          activeElement.contentEditable === 'true'
        );
        
        if (!isInputField) {
          handleUndo();
        }
      }
      
      // Handle Ctrl+Y (Redo)
      else if (event.ctrlKey && event.key === 'y') {
        const activeElement = document.activeElement;
        const isInputField = activeElement && (
          activeElement.tagName === 'INPUT' || 
          activeElement.tagName === 'TEXTAREA' || 
          activeElement.contentEditable === 'true'
        );
        
        if (!isInputField) {
          handleRedo();
        }
      }
      
      // Handle Backspace (Delete selected element)
      else if (event.key === 'Backspace') {
        const activeElement = document.activeElement;
        const isInputField = activeElement && (
          activeElement.tagName === 'INPUT' || 
          activeElement.tagName === 'TEXTAREA' || 
          activeElement.contentEditable === 'true'
        );
        
        //only delete canvas elements if not in an input field
        if (!isInputField && selectedStrokeId) {
          handleDelete();
        }
      }
    };

    // Add event listener to detect keys
    document.addEventListener('keydown', handleKeyDown);

    // Cleanup function to remove event listener
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedStrokeId]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const transform = { x: 0, y: 0 };
    let startX = 0, startY = 0;
    let isPanning = false;

    const onMouseDown = (e) => {
      if (e.button !== 2) return;
      isPanning = true;
      startX = e.clientX - transform.x;
      startY = e.clientY - transform.y;
    };

    const onMouseMove = (e) => {
      if (!isPanning) return;
      let newX = e.clientX - startX;
      let newY = e.clientY - startY;

      const minX = -2000, maxX = 1000;
      const minY = -3000, maxY = 500;
      newX = Math.max(minX, Math.min(maxX, newX));
      newY = Math.max(minY, Math.min(maxY, newY));

      transform.x = newX;
      transform.y = newY;
      canvas.style.transform = `translate(${newX}px, ${newY}px)`;
    };

    const onMouseUp = () => {
      isPanning = false;
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#ccc' }}>
      <Toolbar
        tool={tool}
        setTool={setTool}
        colour={colour}
        setColour={setColour}
        brushSize={brushSize}
        setBrushSize={setBrushSize}
        selectedStrokeId={selectedStrokeId}  // Add this line
        selectedElement={allStrokes.find(s => s.id === selectedStrokeId)}
        onSelectColourChange={handleSelectColourChange}
        onMoveUp={handleMoveUp}
        onMoveDown={handleMoveDown}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onImageUpload={handleImageUpload}
        onTextAdd={handleTextAdd}
        onDeselect={handleDeselect}
      />
      <div className="floating-buttons">
        <button onClick={handleUndo} disabled={actionHistory.current.length === 0} className="circle-btn"><FaUndoAlt /></button>
        <button onClick={handleRedo} disabled={redoHistory.current.length === 0} className="circle-btn"><FaRedoAlt /></button>
      </div>

      <div className="whiteboard-page">
        <div className="canvas-wrapper">
        </div>
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          style={{
            display: 'block',
            margin: '0 auto',
            border: '5px solid #888',
            backgroundColor: 'white',
            cursor: isDrawing ? 'crosshair' : 'default',
            transform: 'translate(0px, 0px)',
          }}
        />
      </div>
    </div>
  );
}
export default Whiteboard;