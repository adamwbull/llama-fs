import { Select, SelectItem, SelectSection, Input, Button, cn, toggle} from "@nextui-org/react";
import { useState, useEffect, useRef } from "react";
import FolderIcon from "./Icons/FolderIcon";
import FileIcon from "./Icons/FileIcon";
import SettingsIcon from "./Icons/SettingsIcon";
import ChevronDown from "./Icons/ChevronDown";
import ChevronRight from "./Icons/ChevronRight";
import ollamaWave from "../../../assets/ollama_wave.gif";
import { useTheme } from "./ThemeContext";
import { useSettings } from "./SettingsContext";
import ThemeBasedLogo from "./ThemeBasedLogo";
import { FileData, AcceptedState, preorderTraversal, buildTree } from "./Utils";
import CustomCheckbox from './CustomCheckbox';
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { debounce } from 'lodash';
import ChevronRight from "./Icons/ChevronRight";
import { fetchBatch, fetchFolderContents } from './API';

declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        sendMessage(channel: string, ...args: unknown[]): void;
        on(channel: string, func: (...args: unknown[]) => void): (() => void);
        once(channel: string, func: (...args: unknown[]) => void): void;
        invoke(channel: string, ...args: unknown[]): Promise<unknown>;
      };
    };
  }
}

function MainScreen() {
  // Persistent settings across sessions.
  const { theme, setTheme } = useTheme();
  const {
    model, setModel,
    fileFormats,
    fileFormatIndex, setFileFormatIndex,
    addFileFormat,
    removeFileFormat,
    groqAPIKey, setGroqAPIKey,
    instruction, setInstruction,
    maxTreeDepth, setMaxTreeDepth,
    processAction, setProcessAction,
    filePath, setFilePath, // TODO: Implement overwriting the filePath variable from Windows/Finder context menu.
    filePathValid, setFilePathValid
  } = useSettings();

  // Per-session variables.
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedFile, setSelectedFile] = useState<FileData | null>(null);
  const handleFileSelect = (fileData: FileData) => {
    setSelectedFile(fileData);
  };

  // Variables for holding the results of LLM computation.
  const [oldNewMap, setOldNewMap] = useState([]);
  const [preOrderedFiles, setPreOrderedFiles] = useState<FileData[]>([]);
  const [acceptedState, setAcceptedState] = useState<AcceptedState>({});

  const [fixedSizePercentage, setFixedSizePercentage] = useState(0);
  
  useEffect(() => {

    window.electron.ipcRenderer.on('open-folder', (folderPath: string) => {
      setFilePath(folderPath);
      fetchFolderContents(filePath).then(contents => setFolderContents(contents));
    });
  
    if (filePathValid) {
      fetchFolderContents(filePath).then(contents => setFolderContents(contents));
    }
    
    const handleResize = () => {
      
      updateFileViewDims()
      
      const container = document.getElementById("panel-container");
      if (container) {
        const fixedPixelSize = 80
  
        var calc = parseInt(((fixedPixelSize / container.offsetHeight) * 100).toFixed(2));
        setFixedSizePercentage(calc);
      }

    };
  
    window.addEventListener('resize', handleResize);
    handleResize(); // Initial call to set dimensions
  
    return () => {
      window.removeEventListener('resize', handleResize);
      window.electron.ipcRenderer.removeAllListeners('open-folder');
    };

  }, [filePathValid]);

  const rightPanelRef = useRef(null);


  // Adjust max tree depth safely within bounds
  const adjustMaxTreeDepth = (delta) => {
    const newDepth = Math.min(10, Math.max(0, maxTreeDepth + delta));
    setMaxTreeDepth(newDepth);
  };

  // Handle action toggle between Move (0) and Duplicate (1)
  const handleActionChange = (action) => {
    if (processAction !== action) {
      setProcessAction(action);
      if (action == 1) {
        rightPanelRef.current.expand()
      } else {
        rightPanelRef.current.collapse()
      }
      updateFileViewDims()
    }
  };

  const [folderContents, setFolderContents] = useState<any[]>([]);

  const [nameWidth, setNameWidth] = useState<number>(200);
  const [sizeWidth, setSizeWidth] = useState<number>(200);
  const [modifiedWidth, setModifiedWidth] = useState<number>(200);

  const handleNameResize = (size: number) => {
    setNameWidth(size);
  };

  const handleSizeResize = (size: number) => {
    setSizeWidth(size);
  };

  const handleModifiedResize =  (size: number) => {
    setModifiedWidth(size);
  };
  
  const handleBrowseFolder = async () => {
    const result = await window.electron.ipcRenderer.invoke('open-folder-dialog');
    if (result) {
      setFilePath(result as string);
      const contents = await fetchFolderContents(result as string);
      console.log('fetchFolderContents:',contents)
      setFolderContents(contents);
      setFilePathValid(true);
    }
  };

  const toggleFolderContentsVisible = (oldFolderContents, target) => {

    return oldFolderContents.map(item => {
      if (item.name === target.name && item.depth === target.depth) {
        return {
          ...item,
          folderContentsDisplayed: !item.folderContentsDisplayed
        };
      } else if (item.folderContents.length > 0) {
        return {
          ...item,
          folderContents: toggleFolderContentsVisible(item.folderContents, target)
        };
      }
      return item;
      
    });

  };

  const attemptToggleFolderContentsVisible = async (toggleFolderVisible: boolean, parentFolderData: any) => {
    try {
      
      var prev = JSON.parse(JSON.stringify(folderContents))
  
      // For toggling parent's status with a shared folderContents.
      if (toggleFolderVisible !== undefined && toggleFolderVisible && parentFolderData !== undefined) {
        prev = toggleFolderContentsVisible(prev, parentFolderData)
      }

      setFolderContents(prev)

    } catch (error) {
      console.error("Error reading directory:", error);
    }
  };

  const truncateName = (name, maxWidth) => {
    const ellipsis = '...';
    let truncatedName = name;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = 'bold 16px Arial'; // Adjust based on your font settings

    while (context.measureText(truncatedName).width > maxWidth) {
      if (truncatedName.length <= 1) {
        break;
      }
      truncatedName = truncatedName.substring(0, truncatedName.length - 1);
    }
    if (context.measureText(name).width > maxWidth) {
      truncatedName += ellipsis;
    }
    return truncatedName;
  };

  const [fileViewHeight, setFileViewHeight] = useState(0);
  const [fileViewWidth, setFileViewWidth] = useState(0);
  const fileViewResizeRef = useRef(null);

  const updateFileViewDims = debounce(() => {
    if (fileViewResizeRef.current) {
      const newHeight = fileViewResizeRef.current.clientHeight;
      const newWidth = fileViewResizeRef.current.clientWidth;
      setFileViewHeight(prevHeight => prevHeight !== newHeight ? newHeight : prevHeight);
      setFileViewWidth(prevWidth => prevWidth !== newWidth ? newWidth-20 : prevWidth);
    }
  }, 200);

  const renderFileItem = (item: any) => {
    const indentStyle = { paddingLeft: `${item.depth*25}px` };
    const maxNameWidth = (nameWidth / 100) * fileViewWidth;
  
    return (
      <div>
        <div
          key={item.name + item.depth}
          className="flex flex-col pb-2"
          style={indentStyle}
        >
          <Button variant="ghost" disableRipple={true} disableAnimation={true}
            onClick={() => {
              if (item.isDirectory) {
                attemptToggleFolderContentsVisible(
                  true,
                  item
                );
              } else {
                // TODO: Trigger opening filePath with an appropriate program.
                // Can we pass off any file to system to have it open, 
                // e.g. photo in a photo viewer, pdf in browser, text in editor, etc.?
              }
            }}>
            <div className="flex flex-row flex-1">
              <div style={{ width: `${maxNameWidth - ((25*item.depth))}px` }} className={`flex flex-row items-center`}>
                <div className="flex flex-row flex-1">
                  <div className="">
                    {item.folderContentsDisplayed && (<ChevronDown color={theme == 'dark' ? "#e3e3e3" : "#121212"} />) ||
                      (<ChevronRight color={theme == 'dark' ? "#e3e3e3" : "#121212"} />)}
                  </div>
                  <span className="mr-2">
                    {item.isDirectory ? <FolderIcon color={"#E8B130"} /> :
                      <FileIcon color={theme == 'dark' ? "#e3e3e3" : "#121212"} />}
                  </span>
                  <span className={item.isDirectory ? "flex flex-1 text-text-primary font-bold text-sm" :
                    "flex flex-1 text-text-primary font-bold text-sm"}>
                    {truncateName(item.name, maxNameWidth - (120 + (25*item.depth)))}
                  </span>
                </div>
              </div>
              <div style={{ width: `${((sizeWidth / 100) * fileViewWidth)}px` }} className={`flex flex-row items-center`}>
                <span className={item.isDirectory ? "flex flex-1 text-text-primary font-bold text-sm" :
                  "flex flex-1 text-text-primary font-bold text-sm"}>
                  {item.size}
                </span>
              </div>
              <div style={{ width: `${((modifiedWidth / 100) * fileViewWidth) - 50}px` }} className={`flex flex-row items-center`}>
                <span className={item.isDirectory ? "flex flex-1 text-text-primary font-bold text-sm" :
                  "flex flex-1 text-text-primary font-bold text-sm"}>
                  {item.modified}
                </span>
              </div>
            </div>
          </Button>
          {item.folderContentsDisplayed && (
            <div className="flex justify-start items-start mt-[5px]">
              {item.folderContents.length > 0 && (
                <div>
                  {item.folderContents.map(subItem => renderFileItem(subItem))}
                </div>
              ) || (
                <div className="flex flex-row items-center ml-[25px] mt-[5px]">
                  <ChevronRight color={theme == 'dark' ? "#e3e3e3" : "#121212"} />
                  <span className="text-text-primary">
                    Folder Empty
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const handleBatch = async () => {

    if (filePathValid) {

      setLoading(true);

      const data = await fetchBatch({
        path: filePath,
        model,
        instruction,
        max_tree_depth: maxTreeDepth,
        file_format: fileFormats[fileFormatIndex],
        groq_api_key: groqAPIKey,
        process_action: processAction
      });

      console.log('batch:', data)
      setLoading(false);

    }

  };

  const openSettings = () => {};

  const [copyFolderContents, setCopyFolderContents] = useState<any[]>([]);

  const [copyNameWidth, setCopyNameWidth] = useState<number>(200);
  const [copySizeWidth, setCopySizeWidth] = useState<number>(200);
  const [copyModifiedWidth, setCopyModifiedWidth] = useState<number>(200);

  const handleCopyNameResize = (size: number) => {
    setCopyNameWidth(size);
  };

  const handleCopySizeResize = (size: number) => {
    setCopySizeWidth(size);
  };

  const handleCopyModifiedResize =  (size: number) => {
    setCopyModifiedWidth(size);
  };
  
  return (
    <div className="flex h-screen w-full">
      <div className="flex-1 flex flex-row">
        {/* SideMenu Start */}
        <div className="w-[200px] flex flex-col bg-primary">
          {/* Logo Section Start */}
          <div className="p-4 flex flex-col">
            <div className="flex items-center gap-2 ml-3">
              <ThemeBasedLogo />
              <span className="text-text-primary font-bold ml-1">Llama-FS</span>
            </div>
          </div>
          {/* Logo Section End */}

          {/* Quick Settings Start */}
          <div className="flex flex-1 flex-col pl-4 pr-4 flex-1">

            {/* Filenames Dropdown Start */}
            {false && (<div className="mb-5">
              <label className="block font-bold mb-2 text-text-primary">File Format</label>
              <div className="">
                <Select
                  selectedKeys={[fileFormatIndex.toString()]}
                  onChange={(e) => { setFileFormatIndex(e.target.value == null ? fileFormatIndex : parseInt(e.target.value)); }}
                  scrollShadowProps={{
                    isEnabled: false,
                  }}
                  classNames={{
                    innerWrapper: "fileformat-select-wrapper",
                    mainWrapper: "fileformat-select-main-wrapper",
                    label: "fileformat-value",
                    value: "fileformat-value"
                  }}
                >
                  {fileFormats.map((format, index) => (
                    <SelectItem key={index} value={index.toString()} 
                      className="text-themeblack bg-themewhite text-xs">
                      {format}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            </div>)}
            {/* Filenames Dropdown End */}

            {/* Max Tree Depth Plus/Minus Scale Start */}
            <div className="flex flex-col">
              <label className="font-bold text-text-primary">Max Tree Depth</label>
              <div className="flex flex-row">
                <div className="flex flex-1 flex-row">
                  <Button auto flat 
                  onClick={() => adjustMaxTreeDepth(-1)} 
                  disabled={maxTreeDepth <= 0} 
                  className="text-text-primary font-bold text-3xl">-</Button>
                  <Input
                    className="mx-2 text-center text-text-primary"
                    classNames={{
                      label: "text-black/50",
                      innerWrapper: "maxtreedepth-input-wrapper",
                      input: "custom-input"
                    }}
                    readOnly
                    value={maxTreeDepth.toString()}
                  />
                  <Button auto flat 
                  onClick={() => adjustMaxTreeDepth(1)} 
                  disabled={maxTreeDepth >= 10} 
                  className="text-text-primary font-bold text-3xl">+</Button>
                </div>
              </div>
            </div>
            {/* Max Tree Depth Plus/Minus Scale End */}

            {/* Move/Duplicate Checkboxes Start */}
            <div className="mt-5 flex flex-col">
              <label className="font-bold text-text-primary">Action</label>
              <div>
                <div className="mt-2 mb-2">
                  <CustomCheckbox
                    isSelected={processAction === 1}
                    onChange={() => handleActionChange(1)}
                    label="Duplicate"
                  />
                </div>
                <div className="">
                  <CustomCheckbox
                    isSelected={processAction === 0}
                    onChange={() => handleActionChange(0)}
                    label="Move"
                  />
                </div>
              </div>
            </div>
            {/* Move/Duplicate Checkboxes End */}
          </div>
          {/* Quick Settings End */}

          {/* Settings Button Start */}
          <div className="border-t border-secondary p-4 flex-row items-center justify-center">
            <Button variant="ghost" onClick={() => openSettings()} className="ml-[46px] items-center justify-center">
              <SettingsIcon className="ml-[15px] h-[40px] w-[40px] text-text-primary" />
              <span className="text-text-primary text-[12px]">More Settings</span>
            </Button>
          </div>
          {/* Settings Button End */}
        </div>
        {/* SideMenu End */}

        {/* Workspace Start */}
        <div className="flex-1 flex flex-col" id="panel-container">
          <PanelGroup direction={"vertical"}>
            
            {/* File Windows Start */}
            <Panel defaultSize={100 - fixedSizePercentage} minSize={100 - fixedSizePercentage} maxSize={100 - fixedSizePercentage} className="flex flex-1">
              {loading ? (
                <div className="flex flex-col items-center">
                  <h2 className="text-lg text-text-primary font-semibold mb-2">
                    Reading and classifying your files...
                  </h2>
                  <div className="flex justify-center w-1/2">
                    <img
                      src={ollamaWave}
                      alt="Loading..."
                      className="w-full"
                    />
                  </div>
                </div>
              ) : (<div className="flex flex-1 flex-col">

                {/* Folder Select Start */}
                <div className="flex bg-primary p-4">
                  <Button className="flex flex-1 bg-accent rounded-3xl" variant="ghost" onClick={handleBrowseFolder}>
                    <Input
                      className="flex flex-1 text-text-primary"
                      classNames={{
                        label: "text-black/50",
                        innerWrapper: "custom-input-wrapper",
                        input: "custom-input"
                      }}
                      placeholder="Select a folder..."
                      type="text"
                      value={filePath}
                    />
                    <div className="text-text-primary rounded-r bg-accent pr-3 rounded-r-3xl">
                      Browse
                    </div>
                  </Button>
                </div>
                {/* Folder Select End */}

                {filePathValid && (<div className="flex flex-1 bg-background flex-1 flex flex-row border-secondary border-t-2 border-b-2">

                  <PanelGroup direction="horizontal" autoSaveId="outerPanel">
                    <Panel defaultSize={50}>
                      {/* Target Start */}
                      <div ref={fileViewResizeRef} className={`flex flex-1 h-full`}>
                        <div className="w-full flex flex-col bg-secondary">

                          <span className={`
                            text-text-primary font-bold 
                            pt-2 pl-4 pr-4 pb-2
                          `}>{filePath}</span>

                          {/* Folder Categories Header Start */}
                          <div className="flex flex-row">
                            <PanelGroup direction="horizontal" autoSaveId="example">
                              <Panel defaultSize={50} minSize={25} onResize={handleNameResize}>
                                <div className="flex flex-row items-center">
                                  <span className="flex flex-1 text-text-secondary font-bold pt-2 pl-4 pr-4 pb-2">
                                    Name
                                  </span>
                                </div>
                              </Panel>
                              <PanelResizeHandle />
                              <Panel defaultSize={15} minSize={20} onResize={handleSizeResize}>
                                <div className="flex flex-row items-center">
                                  <span className="w-[3px] h-[24px] rounded bg-text-secondary"></span>
                                  <span className="flex flex-1 text-text-secondary font-bold pt-2 pl-4 pr-4 pb-2">
                                    Size
                                  </span>
                                </div>
                              </Panel>
                              <PanelResizeHandle />
                              <Panel defaultSize={35} minSize={25} onResize={handleModifiedResize}>
                                <div className="flex flex-row items-center">
                                  <span className="w-[3px] h-[24px] rounded bg-text-secondary"></span>
                                  <span className="flex flex-1 text-text-secondary font-bold pt-2 pl-4 pr-4 pb-2">
                                    Modified
                                  </span>
                                </div>
                              </Panel>
                            </PanelGroup>
                          </div>
                          {/* Folder Categories Header End */}

                          {/* File Section Start */}
                          <div className="parent" style={{height:fileViewHeight-80}}>
                            <div className="scrollview flex-col bg-background">
                              {folderContents.map(item => renderFileItem(item))}
                            </div>
                          </div>
                          {/* File Section End */}
                        </div>
                      </div>
                      {/* Target End */}
                    </Panel>
                    <Panel defaultSize={50} ref={rightPanelRef} collapsible={true}>
                      {/* Copy Preview Start */}
                      {processAction == 1 && (<div className="flex-1 flex flex-col p-4 bg-background text-text-primary">
                        Hello World!
                      </div>)}
                      {/* Copy Preview  End */}
                    </Panel>
                  </PanelGroup>

                </div>) 
                  || (<div className="flex flex-1 justify-center pt-4 bg-background">
                    <span className="text-text-primary">
                      Select a folder to organize.
                    </span>
                </div>)}

              </div>)}
            </Panel>
            {/* File Windows End */}
            

            
            {/* Instruction Area Start */}
            <Panel defaultSize={fixedSizePercentage} minSize={fixedSizePercentage} maxSize={fixedSizePercentage} className="flex flex-1 flex-col pr-4 pl-5 pb-4 pt-2 border-t border-secondary bg-secondary">
              <label className="block font-bold mb-2 text-text-primary ">Prompt</label>
              <div className="flex flex-1 flex-row">
                <div className="flex flex-1 flex-row">
                  {/* Prompt Start */}
                  <div className="flex flex-1">
                    <Input
                      className="w-full"
                      classNames={{
                        label: "text-black/50",
                        innerWrapper: "prompt-input-wrapper",
                        input: "custom-input"
                      }}
                      placeholder={`E.g. Organize by unique people and locations.`}
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                    />

                  </div>
                  {/* Prompt End */}

                  {/* Submit Button Start */}
                  <div className={'ml-2'}>

                    <Button auto flat disableAnimation={true}
                    onClick={handleBatch} 
                    className={`${filePathValid ? 'bg-success' : 'bg-background'} text-themewhite pt-2 pb-2 pl-4 pr-4 rounded-3xl h-[40px]`}
                    >Organize!</Button>

                  </div>
                  {/* Submit Button End */}
                </div>
              </div>
            </Panel>
            {/* Instruction Area End */}
            
          </PanelGroup>
        </div>
        {/* Workspace End */}
      </div>
    </div>
  );
}

export default MainScreen;
