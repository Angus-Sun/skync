import React, { useState, useEffect } from 'react';
import {
  FaPen,
  FaMousePointer,
  FaPlus,
  FaTimes,
  FaArrowUp,
  FaArrowDown,
  FaClone,
  FaTrash,
  FaImage,
  FaFont,
} from 'react-icons/fa';
import './Toolbar.css';

function Toolbar({
  tool,
  setTool,
  colour,
  setColour,
  brushSize,
  setBrushSize,
  selectedStrokeId,
  selectedElement,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDelete,
  onSelectColourChange,
  onImageUpload,
  onTextAdd,
  onDeselect
}) {
  const [colours, setColours] = useState([
    '#000000',
    '#ff0000',
    '#0000ff',
    '#00ff00',
    '#ffff00',
  ]);
  const [showBrushSettings, setShowBrushSettings] = useState(false);
  const [showSelectSettings, setShowSelectSettings] = useState(false);
  const [showImageSettings, setShowImageSettings] = useState(false);
  const [showTextSettings, setShowTextSettings] = useState(false);
  const [tempColour, setTempColour] = useState(colour);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (selectedStrokeId) {
      setTempColour('');
    }
  }, [selectedStrokeId]);

  const handleNewColour = (newColour) => {
    setColour(newColour);
    setColours((prevColours) => {
      if (prevColours.includes(newColour)) return prevColours;
      return [newColour, ...prevColours].slice(0, 5);
    });
  };

  //for select tool color picker changes
  const handleSelectColourChange = (newColour) => {
    setTempColour(newColour);
    if (onSelectColourChange) onSelectColourChange(newColour);
  };

  const handlePenClick = () => {
    setTool('pen');
    setShowBrushSettings(true);

    setShowSelectSettings(false);
    setShowImageSettings(false);
    setShowTextSettings(false);
  };

  const handleImageClick = () => {
    setTool('image');
    setShowBrushSettings(false);

    setShowSelectSettings(false);
    setShowImageSettings(true);
    setShowTextSettings(false);
  };

  const handleTextClick = () => {
    setTool('text');
    setShowBrushSettings(false);

    setShowSelectSettings(false);
    setShowImageSettings(false);
    setShowTextSettings(true);
  };

  const handleImageUpload = (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (onImageUpload) {
          onImageUpload(e.target.result);
        }
        setShowImageSettings(false);
        setTool('none');
      };
      reader.readAsDataURL(file);
    }
    //reset the input so the same file can be selected again
    event.target.value = '';
  };

  return (
    <div className="toolBar">
      {/* Show main tools only if no settings open */}
      {!showBrushSettings && !showSelectSettings && !showImageSettings && !showTextSettings && !selectedStrokeId && (
        <>
          <button
            className={tool === 'pen' ? 'active' : ''}
            onClick={handlePenClick}
            title="Pen"
          >
            <FaPen />
          </button>

          <button
            className={tool === 'image' ? 'active' : ''}
            onClick={handleImageClick}
            title="Add Image"
          >
            <FaImage />
          </button>
          <button
            className={tool === 'text' ? 'active' : ''}
            onClick={handleTextClick}
            title="Add Text"
          >
            <FaFont />
          </button>
        </>
      )}

      {/* Pen settings */}
      {showBrushSettings && (
        <div className="pen-settings-container">
          <button
            className="close-button"
            onClick={() => {
              setShowBrushSettings(false)
              setTool('none')
            }}
            title="Close"
          >
            <FaTimes />
          </button>
          <input
            type="range"
            min="1"
            max="30"
            value={brushSize}
            onChange={(e) => setBrushSize(parseInt(e.target.value))}
            title="Brush Size"
          />
          <div className="colour-options-row">
            <label
              className={`colour-picker ${pickerOpen ? 'open' : ''}`}
              style={{ backgroundColor: pickerOpen ? tempColour : 'transparent' }}
            >
              {!pickerOpen && <FaPlus color="#555" />}
              <input
                type="color"
                className="colour-input"
                value={tempColour}
                onFocus={() => setPickerOpen(true)}
                onBlur={() => {
                  setPickerOpen(false);
                  handleNewColour(tempColour);
                }}
                onInput={(e) => {
                  setTempColour(e.target.value);
                  setColour(e.target.value);
                }}
              />
            </label>
            {colours.map((c) => (
              <button
                key={c}
                className={`colour-swatch ${c === colour ? 'selected' : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => handleNewColour(c)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Image settings */}
      {showImageSettings && (
        <div className="image-settings-container">
          <button
            className="close-button"
            onClick={() => {
              setShowImageSettings(false)
              setTool('none')
            }}
            title="Close"
          >
            <FaTimes />
          </button>
          <label className="upload-button" title="Upload Image">
            <FaImage style={{ marginRight: '5px' }} />
            Upload
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      )}

      {/* Text settings */}
      {showTextSettings && (
        <div className="text-settings-container">
          <button
            className="close-button"
            onClick={() => {
              setShowTextSettings(false)
              setTool('none')
            }}
            title="Close"
          >
            <FaTimes />
          </button>

          {/* Color picker for text */}
          <div className="colour-options-row">
            <label
              className={`colour-picker ${pickerOpen ? 'open' : ''}`}
              style={{ backgroundColor: pickerOpen ? tempColour : 'transparent' }}
            >
              {!pickerOpen && <FaPlus color="#555" />}
              <input
                type="color"
                className="colour-input"
                value={tempColour}
                onFocus={() => setPickerOpen(true)}
                onBlur={() => {
                  setPickerOpen(false);
                  handleNewColour(tempColour);
                }}
                onInput={(e) => {
                  setTempColour(e.target.value);
                  setColour(e.target.value);
                }}
              />
            </label>
            {colours.map((c) => (
              <button
                key={c}
                className={`colour-swatch ${c === colour ? 'selected' : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => handleNewColour(c)}
              />
            ))}
          </div>
          <button 
            className="add-text-button"
            onClick={() => {
              if (onTextAdd) onTextAdd();
              //close the text settings panel after adding text
              setShowTextSettings(false);
              setTool('none');
            }}
            title="Add Text"
          >
            <FaFont /> Add Text
          </button>
        </div>
      )}

        {selectedStrokeId && (
          <div className="select-settings-container">
            <button
              className="close-button"
              onClick={() => {
                setShowSelectSettings(false)
                setTool('none')
                if (onDeselect) {
                  onDeselect();
                }
              }}
            >
              <FaTimes />
            </button>

            {/* Color picker - only show for non-image elements */}
            {selectedElement && selectedElement.type !== 'image' && (
              <div className="colour-options-row">
                <label
                  className={`colour-picker ${pickerOpen ? 'open' : ''}`}
                  style={{ backgroundColor: pickerOpen ? tempColour : 'transparent' }}
                >
                  {!pickerOpen && <FaPlus color="#555" />}
                  <input
                    type="color"
                    className="colour-input"
                    value={tempColour}
                    onFocus={() => setPickerOpen(true)}
                    onBlur={() => {
                      setPickerOpen(false);
                      handleSelectColourChange(tempColour);
                    }}
                    onInput={(e) => {
                      setTempColour(e.target.value);
                      handleSelectColourChange(e.target.value);
                    }}
                  />
                </label>
                {colours.map((c) => (
                  <button
                    key={c}
                    className={`colour-swatch ${c === tempColour ? 'selected' : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => {
                      handleSelectColourChange(c);
                      setTempColour(c); 
                    }}
                  />
                ))}
              </div>
            )}

            {/* Layer controls */}
            <button onClick={onMoveUp} title="Move Up Layer">
              <FaArrowUp />
            </button>
            <button onClick={onMoveDown} title="Move Down Layer">
              <FaArrowDown />
            </button>

            {/* Duplicate */}
            <button onClick={onDuplicate} title="Duplicate">
              <FaClone />
            </button>

            {/* Delete */}
            <button onClick={onDelete} title="Delete">
              <FaTrash />
            </button>
          </div>
        )}
    </div>
  );
}

export default Toolbar;