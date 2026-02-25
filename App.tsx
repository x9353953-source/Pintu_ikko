import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import JSZip from 'jszip';
import { ImageItem, Settings, MaskMode } from './types';
import { drawAsync, getRatio, parseMaskIndices, saveImageToDB, saveImagesToDB, loadImagesFromDB, clearImagesDB, deleteImageFromDB, drawNumber } from './utils';
import ImageGrid from './ImageGrid';

const SETTINGS_KEY = 'puzzleSettings_Ultimate_V4_React';
const UPDATE_KEY = 'puzzle_update_notice_v4_React';
const NOTE_KEY = 'puzzle_hide_notes_v4_React';

const MAX_CANVAS_DIMENSION = 8192;

const DEFAULT_SETTINGS: Settings = {
  aspectRatio: '0.75',
  customW: 1000,
  customH: 1500,
  gap: 0,
  showNum: true,
  startNumber: 1,
  fontSize: 350,
  fontWeight: 'bold', 
  fontColor: '#FFFFFF',
  enableStroke: true, 
  fontStrokeColor: '#000000',
  fontShadowColor: '#000000',
  enableShadow: false,
  fontFamily: 'sans-serif',
  fontPos: 'bottom-center',
  cols: 3,
  groupRows: 3, 
  overlayImgUrl: null,
  overlayMode: 'source-over',
  overlayOpacity: 1,
  qualityVal: 50, 
  maskMode: 'line', // Persisted
  maskIndices: '',
  maskColor: '#FF3B30',
  maskWidth: 10,
  lineStyle: 'cross',
  stickerImgUrl: null,
  stickerSize: 50,
  stickerX: 50,
  stickerY: 50,
  combineCols: 1,
  combineRows: '', // '' means auto
  combineGap: 0,
};

function App() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [generatedBlobs, setGeneratedBlobs] = useState<Blob[]>([]);
  const [combinedImageBlob, setCombinedImageBlob] = useState<Blob | null>(null);
  
  // UI States
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('准备中...');
  
  // Modals
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewImgSrc, setPreviewImgSrc] = useState<string | null>(null);
  const [showImageAction, setShowImageAction] = useState(false);
  const [targetImageIndex, setTargetImageIndex] = useState<number>(-1);
  const [showDragOverlay, setShowDragOverlay] = useState(false);
  const [showResetAlert, setShowResetAlert] = useState(false);
  const [showClearAlert, setShowClearAlert] = useState(false);

  // Sticker/Mask Preview Ref
  const smallStickerCanvasRef = useRef<HTMLCanvasElement>(null);
  const linePreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Cache refs for preview optimization
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const stickerImageRef = useRef<HTMLImageElement | null>(null);
  const lastBgUrlRef = useRef<string | null>(null);
  const lastStickerUrlRef = useRef<string | null>(null);
  const rafRef = useRef<number>(0);

  // Refs
  const gridRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const stickerInputRef = useRef<HTMLInputElement>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cancelRef = useRef(false);

  // --- Initialization ---
  useEffect(() => {
    // Load settings
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSettings(prev => ({ ...prev, ...parsed }));
      } catch (e) { console.error(e); }
    }

    // Load Images from DB (Persistence)
    const initImages = async () => {
        try {
            const stored = await loadImagesFromDB();
            if (stored && stored.length > 0) {
                const restoredImages = stored.map(item => ({
                    id: item.id,
                    url: URL.createObjectURL(item.blob),
                    name: item.name,
                    size: item.size
                }));
                setImages(restoredImages);
            }
        } catch(e) { console.error("DB Load Error", e); }
    };
    initImages();

    if (!localStorage.getItem(UPDATE_KEY)) {
      setTimeout(() => setShowUpdateModal(true), 500);
    }
    
    return () => {
      images.forEach(img => URL.revokeObjectURL(img.url));
    };
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }, 500);
    return () => clearTimeout(timer);
  }, [settings]);

  // --- Real-time Sticker Preview Logic (Optimized) ---
  useEffect(() => {
    const render = async () => {
        const canvas = settings.maskMode === 'image' ? smallStickerCanvasRef.current : linePreviewCanvasRef.current;
        if (!canvas) return;
        
        const w = 300;
        const h = 300;
        
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.clearRect(0,0,w,h);
        
        // 1. Prepare Background Image
        let bgImg = bgImageRef.current;
        const currentBgUrl = images.length > 0 ? images[0].url : null;
        
        if (currentBgUrl && currentBgUrl !== lastBgUrlRef.current) {
             bgImg = new Image();
             bgImg.src = currentBgUrl;
             await new Promise(r => { bgImg!.onload = r; bgImg!.onerror = r; });
             bgImageRef.current = bgImg;
             lastBgUrlRef.current = currentBgUrl;
        } else if (!currentBgUrl) {
             bgImageRef.current = null;
             lastBgUrlRef.current = null;
             bgImg = null;
        }

        // Draw BG
        if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
             const sRatio = bgImg.width / bgImg.height;
             const cRatio = w / h;
             if(sRatio > cRatio) ctx.drawImage(bgImg, (bgImg.width - bgImg.height*cRatio)/2, 0, bgImg.height*cRatio, bgImg.height, 0, 0, w, h);
             else ctx.drawImage(bgImg, 0, (bgImg.height - bgImg.width/cRatio)/2, bgImg.width, bgImg.width/cRatio, 0, 0, w, h);
        } else {
             ctx.fillStyle = '#f0f0f0'; ctx.fillRect(0,0,w,h); 
             ctx.fillStyle = '#ccc'; ctx.textAlign = 'center'; ctx.fillText('无图', w/2, h/2);
        }

        // 2. Prepare Sticker Image
        let stickerImg = stickerImageRef.current;
        const currentStickerUrl = settings.stickerImgUrl;
        
        if (settings.maskMode === 'image' && currentStickerUrl) {
             if (currentStickerUrl !== lastStickerUrlRef.current) {
                 stickerImg = new Image();
                 stickerImg.src = currentStickerUrl;
                 await new Promise(r => { stickerImg!.onload = r; stickerImg!.onerror = r; });
                 stickerImageRef.current = stickerImg;
                 lastStickerUrlRef.current = currentStickerUrl;
             }
             
             if (stickerImg && stickerImg.complete && stickerImg.naturalWidth > 0) {
                const sizePct = settings.stickerSize / 100; 
                const xPct = settings.stickerX / 100;
                const yPct = settings.stickerY / 100; 
                const sw = w * sizePct; 
                const sh = sw * (stickerImg.height / stickerImg.width);
                const dx = (w * xPct) - sw/2; 
                const dy = (h * yPct) - sh/2;
                ctx.drawImage(stickerImg, dx, dy, sw, sh);
             }
        }
        
        // Draw Line
        if (settings.maskMode === 'line') {
             ctx.beginPath();
             ctx.strokeStyle = settings.maskColor; 
             ctx.lineWidth = settings.maskWidth * (w/500) * 5; 
             ctx.lineCap = 'round';
             if (settings.lineStyle === 'cross') { 
                  ctx.moveTo(w*0.2, h*0.2); ctx.lineTo(w*0.8, h*0.8); 
                  ctx.moveTo(w*0.8, h*0.2); ctx.lineTo(w*0.2, h*0.8); 
             } else { 
                  ctx.moveTo(w*0.2, h*0.8); ctx.lineTo(w*0.8, h*0.2); 
             }
             ctx.stroke();
        }
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(render);
    
    return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [settings, images]);


  // --- SortableJS Removed (Moved to ImageGrid) ---

  // --- File Handling (Optimized) ---
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    setIsLoading(true);
    setLoadingText('正在导入...');

    const fileArray = Array.from(files);
    // Process in chunks to avoid UI freeze
    const CHUNK_SIZE = 50;
    
    for (let i = 0; i < fileArray.length; i += CHUNK_SIZE) {
        const chunk = fileArray.slice(i, i + CHUNK_SIZE);
        const newImages: ImageItem[] = [];
        const dbItems: { item: ImageItem; blob: Blob }[] = [];
        
        for (const file of chunk) {
            if (file.type.startsWith('image/') || file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
                const id = Math.random().toString(36).substr(2, 9);
                const url = URL.createObjectURL(file);
                const item = { id, url, name: file.name, size: file.size };
                newImages.push(item);
                dbItems.push({ item, blob: file });
            }
        }
        
        if (dbItems.length > 0) {
            saveImagesToDB(dbItems).catch(e => console.error("DB Save Fail", e));
        }
        
        setImages(prev => [...prev, ...newImages]);
        // Yield to UI
        await new Promise(r => requestAnimationFrame(r));
    }
    
    setIsLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setShowDragOverlay(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.relatedTarget === null) setShowDragOverlay(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setShowDragOverlay(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleReplace = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0 && targetImageIndex > -1) {
      const file = files[0];
      const newUrl = URL.createObjectURL(file);
      const img = images[targetImageIndex];
      
      // Update DB
      saveImageToDB({ ...img, url: newUrl, name: file.name, size: file.size }, file);

      setImages(prev => {
        const next = [...prev];
        URL.revokeObjectURL(next[targetImageIndex].url);
        next[targetImageIndex] = {
           ...next[targetImageIndex],
           url: newUrl,
           name: file.name,
           size: file.size
        };
        return next;
      });
      setShowImageAction(false);
    }
    if (replaceInputRef.current) replaceInputRef.current.value = '';
  };

  const deleteImage = useCallback(() => {
    if (targetImageIndex < 0 || targetImageIndex >= images.length) return;
    
    if (window.confirm('确定删除?')) {
      const img = images[targetImageIndex];
      deleteImageFromDB(img.id).catch(console.error);
      
      setImages(prev => {
        const next = [...prev];
        // Revoke URL to free memory
        if (next[targetImageIndex]) {
             URL.revokeObjectURL(next[targetImageIndex].url);
        }
        next.splice(targetImageIndex, 1);
        return next;
      });
      setShowImageAction(false);
      setTargetImageIndex(-1); // Reset index
    }
  }, [images, targetImageIndex]);

  const clearAll = useCallback(() => {
    setShowClearAlert(true);
  }, []);

  const confirmClearAll = useCallback(() => {
      clearImagesDB();
      setImages(prev => {
          prev.forEach(i => URL.revokeObjectURL(i.url));
          return [];
      });
      setShowClearAlert(false);
  }, []);

  const removeDuplicates = useCallback(() => {
     setImages(prev => {
        const seen = new Set();
        return prev.filter(item => {
           const key = item.name + item.size;
           const duplicate = seen.has(key);
           seen.add(key);
           if (duplicate) {
             URL.revokeObjectURL(item.url);
             deleteImageFromDB(item.id);
           }
           return !duplicate;
        });
     });
  }, []);

  const handleReorder = useCallback((oldIndex: number, newIndex: number) => {
    setImages(prev => {
      const newList = [...prev];
      const [moved] = newList.splice(oldIndex, 1);
      newList.splice(newIndex, 0, moved);
      return newList;
    });
  }, []);

  const handleImageClick = useCallback((index: number) => {
    setTargetImageIndex(index);
    setShowImageAction(true);
  }, []);

  // --- Generation Logic ---
  const cancelProcess = () => {
    cancelRef.current = true;
    setIsLoading(false);
    alert('已取消生成');
  };

  const runGeneration = async (opType: 'normal' | 'apply' | 'repack') => {
    if (images.length === 0) {
      alert('请添加图片');
      return;
    }

    cancelRef.current = false;
    setGeneratedBlobs([]);
    setIsLoading(true);
    setLoadingText('准备开始...');
    
    // Allow UI to render loading state
    await new Promise(r => setTimeout(r, 50));

    // Determine targets
    let targets = images.map(img => img.url);
    const startNum = settings.startNumber;
    
    // Parse mask indices
    const maskIndicesArr = parseMaskIndices(settings.maskIndices);
    
    // Repack logic
    if (opType === 'repack') {
       targets = targets.filter((_, i) => !maskIndicesArr.includes(startNum + i));
    }
    
    // Configs
    const cols = settings.cols || 3;
    const rows = settings.groupRows || 50;
    const batchSize = cols * rows;
    let qVal = settings.qualityVal;
    if (qVal < 10) qVal = 10; 
    if (qVal > 100) qVal = 100;
    const isPng = (qVal === 100);
    const mimeType = isPng ? 'image/png' : 'image/jpeg';
    const totalBatches = Math.ceil(targets.length / batchSize);
    
    const canvas = canvasRef.current;
    if (!canvas) { setIsLoading(false); return; }
    const ctx = canvas.getContext('2d')!;
    
    const tempBlobs: Blob[] = [];

    try {
      for (let b = 0; b < totalBatches; b++) {
         if (cancelRef.current) break;
         
         setLoadingText(`正在生成 ${b+1}/${totalBatches} 组... `);
         // GC Pause
         await new Promise(r => setTimeout(r, 200));

         const currentImgs = targets.slice(b*batchSize, Math.min((b+1)*batchSize, targets.length));
         const ratio = getRatio(settings);
         
         let cellW = 1500;
         if (cols * cellW > MAX_CANVAS_DIMENSION) {
             cellW = Math.floor((MAX_CANVAS_DIMENSION - (settings.gap * cols)) / cols);
         }
         let cellH = Math.floor(cellW / ratio);

         const drawSettings = {
           ...settings,
           stickerImgUrl: settings.maskMode === 'image' ? settings.stickerImgUrl : null
         };

         await drawAsync(
           ctx, 
           currentImgs, 
           Math.ceil(currentImgs.length / cols), 
           cols, 
           cellW, 
           cellH, 
           settings.gap, 
           b * batchSize, 
           startNum, 
           maskIndicesArr, 
           drawSettings, 
           (opType === 'apply' || opType === 'normal' && settings.maskIndices.length > 0), 
           () => cancelRef.current
         );
         
         if (cancelRef.current) break;
         
         const blob = await new Promise<Blob | null>(resolve => 
             canvas.toBlob(resolve, mimeType, isPng ? undefined : qVal / 100)
         );
         
         if (blob) tempBlobs.push(blob);
         
         // Clear canvas
         ctx.clearRect(0,0, canvas.width, canvas.height);
         canvas.width = 1; canvas.height = 1;
      }

      if (!cancelRef.current) {
         setGeneratedBlobs(tempBlobs);
         // Scroll to result
         setTimeout(() => {
            document.getElementById('resultArea')?.scrollIntoView({ behavior: 'smooth' });
         }, 100);
      }
    } catch (e: any) {
       if (!cancelRef.current) alert('生成中断: ' + e.message);
    }
    
    setIsLoading(false);
  };

  // --- Downloads ---
  const downloadBlob = (blob: Blob, name: string) => {
    const link = document.createElement('a');
    link.download = name;
    link.href = URL.createObjectURL(blob);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const generateCombinedImage = async () => {
     if (generatedBlobs.length === 0) return;
     if (images.length > 100) {
       alert('⚠️ 图片数量超过100张，禁止合并导出。\n请使用 "打包下载 (ZIP)"。');
       return;
     }
     setIsLoading(true);
     setLoadingText('正在合并...');
     try {
        const bitmaps = await Promise.all(generatedBlobs.map(b => createImageBitmap(b)));
        const cols = Number(settings.combineCols) || 1;
        const gap = Number(settings.combineGap) || 0;
        const userRows = Number(settings.combineRows) || 0;
        
        let validBitmaps = bitmaps;
        if (userRows > 0 && validBitmaps.length > cols * userRows) {
            validBitmaps = validBitmaps.slice(0, cols * userRows);
        }
        
        const rows = userRows > 0 ? userRows : Math.ceil(validBitmaps.length / cols);
        
        const cellW = validBitmaps[0].width;
        
        const rowHeights: number[] = [];
        for (let r = 0; r < rows; r++) {
            let maxH = 0;
            for (let c = 0; c < cols; c++) {
                const i = r * cols + c;
                if (i < validBitmaps.length) {
                    maxH = Math.max(maxH, validBitmaps[i].height);
                }
            }
            rowHeights.push(maxH);
        }
        
        let maxW = cols * cellW + (cols - 1) * gap;
        let totalH = rowHeights.reduce((sum, h) => sum + h, 0) + (rows > 0 ? (rows - 1) * gap : 0);
        
        // Apply quality scale
        let scale = settings.qualityVal / 100;
        
        // Check limits
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const MAX_PIXELS = isMobile ? 16777216 : 50000000;
        
        if (maxW * scale * totalH * scale > MAX_PIXELS) {
            const mobileScale = Math.sqrt(MAX_PIXELS / (maxW * totalH * scale * scale));
            scale *= mobileScale;
            console.warn(`Image too large, scaling down by ${scale}`);
            alert(`提示：图片总像素过大，已自动等比例缩小以适配手机浏览器限制。`);
        }
        
        const finalW = Math.floor(maxW * scale);
        const finalH = Math.floor(totalH * scale);
        
        const cvs = document.createElement('canvas');
        cvs.width = finalW; cvs.height = finalH;
        const ctx = cvs.getContext('2d')!;
        
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, finalW, finalH);
        
        ctx.scale(scale, scale);
        
        let currentY = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const i = r * cols + c;
                if (i >= validBitmaps.length) break;
                
                const x = c * (cellW + gap);
                const y = currentY;
                const dw = validBitmaps[i].width;
                const dh = validBitmaps[i].height;
                ctx.drawImage(validBitmaps[i], x, y, dw, dh);
            }
            currentY += rowHeights[r] + gap;
        }
        
        cvs.toBlob(blob => {
           if(blob) {
               setCombinedImageBlob(blob);
           }
           setIsLoading(false);
        }, settings.qualityVal === 100 ? 'image/png' : 'image/jpeg', settings.qualityVal/100);
        
     } catch (e) {
        alert('合并失败');
        setIsLoading(false);
     }
  };

  const downloadCombinedImage = () => {
      if (!combinedImageBlob) return;
      const ext = settings.qualityVal === 100 ? 'png' : 'jpg';
      downloadBlob(combinedImageBlob, `拼图_合并版_${new Date().getTime()}.${ext}`);
  };

  const handleDownload = async (type: 'parts' | 'zip') => {
     if (generatedBlobs.length === 0) return;
     
     if (type === 'zip') {
        setIsLoading(true);
        setLoadingText('正在打包 ZIP...');
        try {
          const zip = new JSZip();
          const folder = zip.folder("拼图分组");
          const ext = settings.qualityVal === 100 ? 'png' : 'jpg';
          generatedBlobs.forEach((blob, i) => folder?.file(`拼图_Part_${i+1}.${ext}`, blob));
          const content = await zip.generateAsync({type:"blob"});
          downloadBlob(content, `拼图打包_${new Date().getTime()}.zip`);
        } catch(e:any) {
           alert('打包失败: ' + e.message);
        }
        setIsLoading(false);
     } else if (type === 'parts') {
         if(!window.confirm(`即将下载 ${generatedBlobs.length} 张图片。\n请允许浏览器下载多个文件。`)) return;
         setIsLoading(true);
         for(let i=0; i<generatedBlobs.length; i++) {
             setLoadingText(`正在下载 ${i+1} / ${generatedBlobs.length}`);
             const blob = generatedBlobs[i];
             const ext = blob.type.includes('png') ? 'png' : 'jpg';
             downloadBlob(blob, `拼图_Part_${i+1}.${ext}`);
             if (i < generatedBlobs.length - 1) await new Promise(r => setTimeout(r, 1500));
         }
         setIsLoading(false);
     }
  };

  // --- Previews ---
  const previewQuality = async () => {
    if (images.length === 0) return alert('请先添加图片');
    setIsLoading(true);
    setLoadingText('生成预览...');
    try {
        const img = new Image();
        img.src = images[0].url;
        await new Promise((resolve, reject) => {
             img.onload = resolve;
             img.onerror = () => reject(new Error('Image load failed'));
        });
        
        if (img.naturalWidth === 0 || img.naturalHeight === 0) throw new Error('Invalid image dimensions');

        const cvs = document.createElement('canvas');
        const scale = Math.min(1, 1000 / img.width);
        cvs.width = img.width * scale;
        cvs.height = img.height * scale;
        const ctx = cvs.getContext('2d')!;
        ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
        
        const q = settings.qualityVal;
        const url = cvs.toDataURL((q===100)?'image/png':'image/jpeg', (q===100)?undefined:q/100);
        setPreviewImgSrc(url);
        setShowPreviewModal(true);
    } catch(e) { 
        console.error(e); 
        alert('预览生成失败: 图片可能已损坏');
    }
    setIsLoading(false);
  };
  
  const previewOverlay = async () => {
      if(images.length === 0 || !settings.overlayImgUrl) return alert('请先添加拼图和覆盖层');
      setIsLoading(true);
      setLoadingText('生成预览...');
      
      const batchSize = 9;
      const previewImgs = images.slice(0, batchSize).map(i => i.url);
      while(previewImgs.length < 9 && images.length > 0) previewImgs.push(images[0].url);
      
      const cvs = document.createElement('canvas');
      const ctx = cvs.getContext('2d')!;
      const ratio = getRatio(settings);
      const w = 200;
      const h = Math.floor(w/ratio);
      
      await drawAsync(
        ctx, previewImgs, 3, 3, w, h, Math.floor(settings.gap/5), 0, 1, [], 
        settings, false, () => false, true
      );
      
      cvs.toBlob(blob => {
         if(blob) {
             setPreviewImgSrc(URL.createObjectURL(blob));
             setShowPreviewModal(true);
         }
         setIsLoading(false);
      }, 'image/jpeg', 0.8);
  };

  const updateSticker = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if(files && files.length > 0) {
          const u = URL.createObjectURL(files[0]);
          setSettings(s => ({ ...s, stickerImgUrl: u }));
      }
      if (stickerInputRef.current) stickerInputRef.current.value = '';
  };
  
  const updateOverlay = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if(files && files.length > 0) {
          const u = URL.createObjectURL(files[0]);
          setSettings(s => ({ ...s, overlayImgUrl: u }));
      }
      if (overlayInputRef.current) overlayInputRef.current.value = '';
  };

  // --- Duplicate check logic ---
  const { duplicatesCount, duplicateGroups } = useMemo(() => {
      const groups: Record<string, ImageItem[]> = {};
      images.forEach(img => {
          const key = img.name + img.size;
          if (!groups[key]) groups[key] = [];
          groups[key].push(img);
      });
      
      const dupGroups = Object.values(groups).filter(g => g.length > 1);
      const count = dupGroups.reduce((acc, g) => acc + g.length - 1, 0);
      
      return { duplicatesCount: count, duplicateGroups: dupGroups };
  }, [images]);

  // --- Helper for inputs ---
  const updateSetting = (key: keyof Settings, val: any) => {
      setSettings(prev => ({ ...prev, [key]: val }));
  };

  return (
    <div className="antialiased text-black relative" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      
      {/* Hidden Canvas */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Inputs */}
      <input type="file" ref={fileInputRef} multiple accept="image/*" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      <input type="file" ref={replaceInputRef} accept="image/*" className="hidden" onChange={handleReplace} />
      <input type="file" ref={stickerInputRef} accept="image/*" className="hidden" onChange={updateSticker} />
      <input type="file" ref={overlayInputRef} accept="image/*" className="hidden" onChange={updateOverlay} />

      {/* Drag Overlay */}
      <div id="dragOverlay" className={showDragOverlay ? 'active' : ''}>
         <div className="text-[#007AFF] font-bold text-2xl bg-white/90 px-6 py-3 rounded-xl shadow-lg">松手释放图片</div>
      </div>

      {/* Loading Toast */}
      <div id="progressToast" className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] transition-all duration-200 cubic-bezier(0.34, 1.56, 0.64, 1) ${isLoading ? 'translate-y-0 opacity-100' : '-translate-y-[200%] opacity-0 pointer-events-none'}`}>
         <div className="bg-white/95 backdrop-blur-xl text-gray-900 rounded-full shadow-2xl flex items-center py-3 pl-6 pr-4 gap-3 border border-gray-200/50 min-w-[200px]">
            <div className="flex-1 flex flex-col justify-center min-w-0">
               <div className="flex items-center justify-center gap-2">
                  <span className="text-[15px] font-bold leading-tight truncate text-[#007AFF]">{loadingText}</span>
               </div>
            </div>
            <button onClick={cancelProcess} className="pointer-events-auto w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 active:scale-90 transition text-gray-500 hover:text-[#FF3B30] shrink-0">
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
         </div>
      </div>

      {/* Clear Alert */}
      {showClearAlert && (
          <div className="modal-overlay animate-fade-in" onClick={() => setShowClearAlert(false)}>
              <div className="bg-[#F2F2F7] w-[270px] rounded-[14px] overflow-hidden text-center backdrop-blur-xl" onClick={e => e.stopPropagation()}>
                  <div className="p-5 pb-4">
                      <h3 className="text-[17px] font-bold mb-1">确定要清空吗？</h3>
                      <p className="text-[13px] text-gray-500">此操作将移除所有已导入的图片，且无法撤销。</p>
                  </div>
                  <div className="grid grid-cols-2 border-t border-gray-300/50 divide-x divide-gray-300/50">
                      <button onClick={() => setShowClearAlert(false)} className="py-3 text-[17px] text-[#007AFF] active:bg-gray-200 transition font-medium">取消</button>
                      <button onClick={confirmClearAll} className="py-3 text-[17px] text-[#FF3B30] active:bg-gray-200 transition font-bold">确认清空</button>
                  </div>
              </div>
          </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#F2F2F7]/90 backdrop-blur-xl border-b border-gray-200/50 supports-[backdrop-filter]:bg-[#F2F2F7]/60">
        <div className="max-w-2xl mx-auto px-5 py-3 flex justify-between items-center h-[52px]">
            <h1 className="text-[22px] font-bold tracking-tight text-black">拼图排序<span className="text-xs font-normal text-white bg-black px-1.5 py-0.5 rounded ml-1">Ultimate</span></h1>
            <div className="flex items-center gap-2">
                <button onClick={() => setShowResetAlert(true)} className="bg-gray-100 text-gray-500 text-[13px] font-bold px-3 py-1.5 rounded-full shadow-sm active:bg-gray-200 transition flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                    重置
                </button>
                <button onClick={() => fileInputRef.current?.click()} className="bg-white text-[#007AFF] text-[15px] font-bold px-4 py-1.5 rounded-full shadow-sm active:bg-gray-100 transition flex items-center gap-1">
                    <svg className="w-4 h-4 stroke-[3px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"></path></svg>
                    添加
                </button>
            </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 pt-4 relative pb-32">
        
        {/* Images Card */}
        <ImageGrid 
            images={images}
            onReorder={handleReorder}
            onImageClick={handleImageClick}
            duplicatesCount={duplicatesCount}
            onRemoveDuplicates={removeDuplicates}
            onClearAll={clearAll}
        />

        {/* Duplicate Images Section */}
        {duplicatesCount > 0 && (
            <div className="mb-2 pl-4 text-[13px] text-yellow-600 uppercase font-medium flex justify-between items-center pr-4">
                <span>重复图片检测 ({duplicatesCount}张)</span>
                <button onClick={removeDuplicates} className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-md font-bold active:bg-yellow-200 transition">一键去重</button>
            </div>
        )}
        {duplicatesCount > 0 && (
            <div className="ios-card mb-6 border border-yellow-200/50">
                <details className="group" open>
                    <summary className="flex items-center justify-between p-4 bg-yellow-50/30 cursor-pointer select-none active:bg-yellow-50 transition">
                        <div>
                            <div className="text-[17px] font-bold text-yellow-800">发现重复图片</div>
                            <div className="text-[10px] text-yellow-600/70 mt-0.5">检测到 {duplicateGroups.length} 组完全相同的图片</div>
                        </div>
                        <svg className="w-4 h-4 text-yellow-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </summary>
                    <div className="p-4 bg-white border-t border-yellow-100/50 space-y-4 max-h-[300px] overflow-y-auto">
                        {duplicateGroups.map((group, idx) => (
                            <div key={idx} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-xs font-bold text-gray-500 truncate max-w-[200px]">{group[0].name}</span>
                                    <span className="text-[10px] text-gray-400">{(group[0].size/1024).toFixed(1)}KB × {group.length}</span>
                                </div>
                                <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                                    {group.map((img) => (
                                        <div key={img.id} className="w-16 h-16 shrink-0 rounded-lg overflow-hidden border border-gray-200 relative">
                                            <img src={img.url} className="w-full h-full object-cover" />
                                            {/* We could add individual delete button here if needed */}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </details>
            </div>
        )}

        {/* Settings: Spacing */}
        <div className="mb-2 pl-4 text-[13px] text-gray-500 uppercase font-medium">单元格与间距</div>
        <div className="ios-card">
            <details className="group">
                <summary className="flex items-center justify-between p-4 bg-white cursor-pointer select-none active:bg-gray-50 transition">
                    <div>
                        <div className="text-[17px] font-bold">单元格与间距设置</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">设置画布比例、留白间隙</div>
                    </div>
                    <svg className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </summary>
                <div className="divide-y divide-gray-200 border-t border-gray-100">
                    <div className="p-4 bg-white active:bg-gray-50 transition relative">
                        <div className="flex items-center justify-between">
                            <span className="text-[17px]">画布比例</span>
                            <div className="flex items-center gap-2">
                                <select value={settings.aspectRatio} onChange={(e) => updateSetting('aspectRatio', e.target.value)} className="text-[#007AFF] text-[17px] pr-6 bg-transparent focus:outline-none text-right appearance-none cursor-pointer dir-rtl">
                                    <option value="0.5625">9:16 手机全屏</option>
                                    <option value="0.75">3:4 海报</option>
                                    <option value="1">1:1 正方形</option>
                                    <option value="1.333">4:3 照片</option>
                                    <option value="custom">自定义...</option>
                                </select>
                            </div>
                        </div>
                        <div className="text-[10px] text-gray-400 mt-1">设置单张图片的宽高比例</div>
                    </div>
                    <div className="p-4 bg-white active:bg-gray-50 transition">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[17px]">图片间隙</span>
                            <span className="text-[#007AFF] font-bold text-[15px]">{settings.gap}px</span>
                        </div>
                        <input type="range" min="0" max="100" value={settings.gap} step="1" onChange={(e) => updateSetting('gap', parseInt(e.target.value))} />
                        <div className="text-[10px] text-gray-400 mt-1">设置图片之间的留白距离</div>
                    </div>
                    
                    {settings.aspectRatio === 'custom' && (
                       <div className="p-4 bg-gray-50 flex items-center justify-end gap-3 border-t border-gray-100">
                           <input type="number" placeholder="宽" className="bg-white border rounded px-2 py-1 text-center w-20 text-sm" value={settings.customW} onChange={(e) => updateSetting('customW', parseInt(e.target.value))} />
                           <span className="text-gray-400">:</span>
                           <input type="number" placeholder="高" className="bg-white border rounded px-2 py-1 text-center w-20 text-sm" value={settings.customH} onChange={(e) => updateSetting('customH', parseInt(e.target.value))} />
                       </div>
                    )}
                </div>
            </details>
        </div>

        {/* Settings: Numbering */}
        <div className="mb-2 pl-4 text-[13px] text-gray-500 uppercase font-medium">序号标注</div>
        <div className="ios-card ios-divide">
            <div className="flex items-center justify-between p-4 bg-white">
                <span className="text-[17px]">显示序号</span>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={settings.showNum} onChange={(e) => updateSetting('showNum', e.target.checked)} className="sr-only peer" />
                    <div className="w-[51px] h-[31px] bg-[#E9E9EA] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-[27px] after:w-[27px] after:shadow-sm after:transition-all peer-checked:bg-[#34C759]"></div>
                </label>
            </div>
            <details className="group">
                <summary className="flex items-center justify-between p-4 bg-white cursor-pointer select-none active:bg-gray-50 transition">
                    <div>
                        <div className="text-[17px] text-[#007AFF]">序号详细设置</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">设置序号大小、颜色、字体、起始位置</div>
                    </div>
                    <svg className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </summary>
                <div className="divide-y divide-gray-200 border-t border-gray-100">
                    <div className="flex items-center justify-between p-4 bg-white">
                        <span className="text-[17px]">起始数值</span>
                        <input type="number" value={settings.startNumber} onChange={(e) => updateSetting('startNumber', parseInt(e.target.value))} className="text-right text-[#007AFF] text-[17px] focus:outline-none w-20 bg-transparent rounded px-2 py-1" />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-white">
                        <span className="text-[17px]">字号大小</span>
                        <input type="number" value={settings.fontSize} onChange={(e) => updateSetting('fontSize', parseInt(e.target.value))} className="text-right text-[#007AFF] text-[17px] focus:outline-none w-20 bg-transparent rounded px-2 py-1" />
                    </div>
                    {/* Font Weight Selection */}
                    <div className="flex items-center justify-between p-4 bg-white">
                        <span className="text-[17px]">字重 (粗细)</span>
                        <select value={settings.fontWeight} onChange={(e) => updateSetting('fontWeight', e.target.value)} className="text-[#007AFF] text-[17px] pr-6 bg-transparent focus:outline-none appearance-none dir-rtl">
                            <option value="300">细体 (Light)</option>
                            <option value="400">常规 (Regular)</option>
                            <option value="500">中粗 (Medium)</option>
                            <option value="bold">粗体 (Bold)</option>
                            <option value="900">特粗 (Heavy)</option>
                        </select>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-white">
                        <span className="text-[17px]">字体颜色</span>
                        <input type="color" value={settings.fontColor} onChange={(e) => updateSetting('fontColor', e.target.value)} className="w-8 h-8 rounded-full overflow-hidden border border-gray-200" />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-white">
                         <div className="flex items-center gap-2">
                            <span className="text-[17px]">描边</span>
                            <label className="flex items-center cursor-pointer gap-1 bg-gray-100 px-2 py-1 rounded-md text-xs text-gray-500 font-bold active:bg-gray-200 transition">
                                <input type="checkbox" checked={settings.enableStroke} onChange={(e) => updateSetting('enableStroke', e.target.checked)} className="accent-[#34C759]" />
                                <span>启用</span>
                            </label>
                        </div>
                        <input type="color" value={settings.fontStrokeColor} onChange={(e) => updateSetting('fontStrokeColor', e.target.value)} className="w-8 h-8 rounded-full overflow-hidden border border-gray-200" />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-white">
                        <div className="flex items-center gap-2">
                            <span className="text-[17px]">阴影</span>
                            <label className="flex items-center cursor-pointer gap-1 bg-gray-100 px-2 py-1 rounded-md text-xs text-gray-500 font-bold active:bg-gray-200 transition">
                                <input type="checkbox" checked={settings.enableShadow} onChange={(e) => updateSetting('enableShadow', e.target.checked)} className="accent-[#34C759]" />
                                <span>启用</span>
                            </label>
                        </div>
                        <div className="flex items-center gap-2">
                            <input type="color" value={settings.fontShadowColor} onChange={(e) => updateSetting('fontShadowColor', e.target.value)} className="w-8 h-8 rounded-full overflow-hidden border border-gray-200" />
                        </div>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-white">
                        <span className="text-[17px]">字体类型</span>
                        <select value={settings.fontFamily} onChange={(e) => updateSetting('fontFamily', e.target.value)} className="text-[#007AFF] text-[17px] pr-6 bg-transparent focus:outline-none appearance-none dir-rtl text-right w-40">
                            <option value="sans-serif">默认 (无衬线)</option>
                            <option value="'Heiti SC', 'Microsoft YaHei', sans-serif">黑体 (Bold)</option>
                            <option value="'Songti SC', 'SimSun', serif">宋体 (Serif)</option>
                            <option value="'KaiTi', '楷体', serif">楷体 (Calligraphy)</option>
                            <option value="'Times New Roman', serif">Times New Roman</option>
                            <option value="cursive">手写风 (Cursive)</option>
                        </select>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-white">
                        <span className="text-[17px]">位置</span>
                        <select value={settings.fontPos} onChange={(e) => updateSetting('fontPos', e.target.value)} className="text-[#007AFF] text-[17px] pr-6 bg-transparent focus:outline-none appearance-none dir-rtl">
                            <option value="bottom-center">底部居中</option>
                            <option value="bottom-left">底部左侧</option>
                            <option value="bottom-right">底部右侧</option>
                            <option value="center">正中间</option>
                            <option value="top-left">左上角</option>
                            <option value="top-right">右上角</option>
                        </select>
                    </div>
                </div>
            </details>
        </div>

        {/* Settings: Layout Strategy */}
        <div className="mb-2 pl-4 text-[13px] text-gray-500 uppercase font-medium">布局与分组</div>
        <div className="ios-card mb-6">
             <details className="group">
                <summary className="flex items-center justify-between p-4 bg-white cursor-pointer select-none active:bg-gray-50 transition">
                    <div>
                        <div className="text-[17px] font-bold">布局与分组</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">设置排列列数、分组方式</div>
                    </div>
                    <svg className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </summary>
                <div className="divide-y divide-gray-200 border-t border-gray-100 p-4 bg-white">
                        <div className="grid grid-cols-2 gap-4 mb-3">
                            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                 <label className="text-[11px] text-gray-500 block mb-1">列数 (横向)</label>
                                 <input type="number" value={settings.cols} onChange={(e) => updateSetting('cols', parseInt(e.target.value))} placeholder="默认:3" className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-center text-sm font-bold text-[#007AFF] focus:border-[#007AFF] outline-none" />
                            </div>
                            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                 <label className="text-[11px] text-gray-500 block mb-1">每组行数 (自动)</label>
                                 <input type="number" value={settings.groupRows} onChange={(e) => updateSetting('groupRows', parseInt(e.target.value))} placeholder="默认:3" className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-center text-sm font-bold text-[#007AFF] focus:border-[#007AFF] outline-none" />
                            </div>
                        </div>
                        <div className="bg-blue-50 p-2.5 rounded text-[10px] text-blue-600 leading-relaxed">
                            <p><b>列数：</b> 决定每一行横向排列几张图片。</p>
                            <p><b>每组行数：</b> 决定一张拼图包含几行。</p>
                        </div>
                </div>
            </details>
        </div>

        {/* Settings: Overlay */}
        <div className="mb-2 pl-4 text-[13px] text-gray-500 uppercase font-medium">覆盖层 & 水印</div>
        <div className="ios-card mb-6">
             <details className="group">
                <summary className="flex items-center justify-between p-4 bg-white cursor-pointer select-none active:bg-gray-50 transition">
                    <div>
                        <div className="text-[17px] font-bold">覆盖层设置</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">添加全局水印或纹理</div>
                    </div>
                    <svg className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </summary>
                <div className="divide-y divide-gray-200 border-t border-gray-100">
                    <div className="p-4 bg-white">
                        <div className="flex items-center justify-between mb-3">
                             <span className="text-sm text-gray-500">选择图片</span>
                            <div className="flex gap-2">
                                <button onClick={previewOverlay} className="text-gray-600 text-[13px] font-bold bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-full active:bg-gray-200 transition flex items-center gap-1">
                                    ☁️ 预览
                                </button>
                                <button onClick={() => overlayInputRef.current?.click()} className="text-[#007AFF] text-[13px] font-bold bg-[#007AFF]/10 px-3 py-1.5 rounded-full active:bg-[#007AFF]/20 transition">
                                    + 图片
                                </button>
                            </div>
                        </div>
                        {settings.overlayImgUrl && (
                           <div className="bg-gray-50 rounded-lg p-2 mb-3 flex items-center justify-between border border-gray-100">
                               <div className="flex items-center gap-2 overflow-hidden">
                                   <img src={settings.overlayImgUrl} className="w-8 h-8 rounded object-cover border border-gray-200 bg-white" alt="overlay" />
                                   <span className="text-xs text-gray-500 truncate max-w-[150px]">覆盖层已加载</span>
                               </div>
                               <button onClick={() => updateSetting('overlayImgUrl', null)} className="text-gray-400 hover:text-[#FF3B30] px-2">✕</button>
                           </div>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-[11px] text-gray-500 block mb-1">混合模式</label>
                                <select value={settings.overlayMode} onChange={(e) => updateSetting('overlayMode', e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold text-gray-700 outline-none">
                                    <option value="source-over">标准 (正常)</option>
                                    <option value="multiply">正片叠底 (变暗)</option>
                                    <option value="screen">滤色 (变亮/添加)</option>
                                    <option value="overlay">覆盖 (叠加)</option>
                                    <option value="soft-light">柔光</option>
                                    <option value="difference">差值</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[11px] text-gray-500 block mb-1">不透明度</label>
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center h-[34px] bg-gray-50 border border-gray-200 rounded-lg px-2 flex-1">
                                        <input type="range" min="0" max="1" step="0.01" value={settings.overlayOpacity} onChange={(e) => updateSetting('overlayOpacity', parseFloat(e.target.value))} className="w-full h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer" />
                                    </div>
                                    <span className="w-14 text-center text-sm font-bold text-[#007AFF]">{(settings.overlayOpacity * 100).toFixed(0)}%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
             </details>
        </div>

        {/* Settings: Quality */}
        <div className="mb-2 pl-4 text-[13px] text-gray-500 uppercase font-medium">导出画质</div>
        <div className="ios-card mb-6">
             <details className="group">
                <summary className="flex items-center justify-between p-4 bg-white cursor-pointer select-none active:bg-gray-50 transition">
                    <div>
                        <div className="text-[17px] font-bold">导出画质</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">控制文件大小与清晰度</div>
                    </div>
                    <svg className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </summary>
                <div className="divide-y divide-gray-200 border-t border-gray-100 p-4 bg-white">
                    <div className="mb-4">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-[15px] font-bold text-gray-700">预设模式</span>
                            <button onClick={previewQuality} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded flex items-center gap-1 transition"><span>👁️ 预览效果</span></button>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                            {[
                                { label: '原图', val: 100, desc: 'PNG' },
                                { label: '高清', val: 95, desc: 'JPG' },
                                { label: '标准', val: 80, desc: 'JPG' },
                                { label: '推荐', val: 50, desc: 'JPG' }
                            ].map((opt) => (
                                <button 
                                    key={opt.val}
                                    onClick={() => updateSetting('qualityVal', opt.val)}
                                    className={`flex flex-col items-center justify-center py-2 rounded-lg border transition-all ${settings.qualityVal === opt.val ? 'bg-[#007AFF]/10 border-[#007AFF] text-[#007AFF]' : 'bg-gray-50 border-gray-100 text-gray-600'}`}
                                >
                                    <span className="text-sm font-bold">{opt.label}</span>
                                    <span className="text-[10px] opacity-70">{opt.desc}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    
                    <div className="pt-4">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-[15px] font-bold text-gray-700">自定义压缩率</span>
                            <span className="text-[#007AFF] font-bold text-[15px]">{settings.qualityVal}%</span>
                        </div>
                        <input 
                            type="range" 
                            min="10" 
                            max="100" 
                            step="1" 
                            value={settings.qualityVal} 
                            onChange={(e) => updateSetting('qualityVal', parseInt(e.target.value))} 
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#007AFF]" 
                        />
                        <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                            <span>更小体积</span>
                            <span>更高画质</span>
                        </div>
                    </div>
                    
                    <div className="mt-3 bg-blue-50 p-2 rounded text-[10px] text-blue-600 flex items-start gap-1">
                        <svg className="w-3 h-3 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        <span>建议设置在 50% - 80% 之间，既能保证清晰度，又能显著减小文件体积，方便传输。</span>
                    </div>
                </div>
             </details>
        </div>

        {/* Masking & Stickers */}
        <div className="ios-card">
            <details className="group">
                <summary className="flex items-center justify-between p-4 bg-white cursor-pointer select-none active:bg-gray-50 transition">
                    <div>
                        <div className="text-[17px] font-bold">打码与贴纸</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">遮挡特定图片或序号、添加贴纸</div>
                    </div>
                    <svg className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </summary>

                <div className="divide-y divide-gray-200 border-t border-gray-100">
                    <div className="p-4 bg-white">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex flex-col">
                                <span className="text-[17px] font-bold text-gray-800">目标序号</span>
                                <span className="text-[10px] text-gray-400">输入数字 (如: 5, 12, 1-3)</span>
                            </div>
                            <input type="text" value={settings.maskIndices} onChange={(e) => updateSetting('maskIndices', e.target.value)} placeholder="如: 5, 12" className="text-right text-[#007AFF] text-[17px] focus:outline-none w-40 placeholder-gray-300 bg-gray-50 rounded px-2 py-1" />
                        </div>
                        <div className="flex p-1 bg-gray-100 rounded-lg mb-4">
                            <button onClick={() => updateSetting('maskMode', 'line')} className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${settings.maskMode==='line' ? 'bg-white shadow text-black' : 'text-gray-500'}`}>画线打码</button>
                            <button onClick={() => updateSetting('maskMode', 'image')} className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${settings.maskMode==='image' ? 'bg-white shadow text-black' : 'text-gray-500'}`}>图片/贴纸</button>
                        </div>

                        {settings.maskMode === 'line' ? (
                          <div className="animate-fade-in">
                            {/* Line Preview (Small Canvas on Left) - Strictly following layout concept */}
                            <div className="flex gap-4 mb-3 border-b border-gray-100 pb-3">
                                 <div className="w-24 h-24 bg-gray-50 rounded-lg overflow-hidden border border-gray-200 shrink-0 relative flex items-center justify-center">
                                     {images.length > 0 ? (
                                        <canvas ref={linePreviewCanvasRef} className="w-full h-full object-contain" />
                                     ) : (
                                        <span className="text-[10px] text-gray-400">预览</span>
                                     )}
                                 </div>
                                 <div className="flex-1 space-y-3 justify-center flex flex-col">
                                      <div className="flex justify-between items-center">
                                          <span className="text-sm text-gray-500">样式</span>
                                          <div className="flex items-center gap-2 text-sm">
                                              <label className="flex items-center gap-1 cursor-pointer">
                                                  <input type="radio" checked={settings.lineStyle === 'cross'} onChange={() => updateSetting('lineStyle', 'cross')} className="accent-[#FF3B30]" /> <span>❌</span>
                                              </label>
                                              <label className="flex items-center gap-1 cursor-pointer">
                                                  <input type="radio" checked={settings.lineStyle === 'slash'} onChange={() => updateSetting('lineStyle', 'slash')} className="accent-[#FF3B30]" /> <span>╱</span>
                                              </label>
                                          </div>
                                      </div>
                                      <div className="flex justify-between items-center">
                                          <span className="text-sm text-gray-500 w-12">设置</span>
                                          <div className="flex items-center flex-1 gap-2">
                                              <input type="color" value={settings.maskColor} onChange={(e) => updateSetting('maskColor', e.target.value)} className="w-6 h-6 rounded-full border border-gray-200 shrink-0" />
                                              <div className="flex-1 h-6 flex items-center">
                                                  <input type="range" min="1" max="20" value={settings.maskWidth} onChange={(e) => updateSetting('maskWidth', parseInt(e.target.value))} className="w-full" />
                                              </div>
                                          </div>
                                      </div>
                                 </div>
                            </div>
                          </div>
                        ) : (
                          <div className="animate-fade-in">
                            <button onClick={() => stickerInputRef.current?.click()} className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 text-sm mb-3 active:bg-gray-50">+ 上传遮挡图 (Logo/贴纸)</button>
                            {/* Sticker Preview (Small Canvas on Left) - Strictly following layout */}
                            {settings.stickerImgUrl && (
                               <div className="flex gap-4 mb-1">
                                   <div className="w-24 h-24 checkered-bg rounded-lg overflow-hidden border border-gray-200 shrink-0 relative cursor-pointer active:scale-95 transition shadow-sm" onClick={() => { setPreviewImgSrc(settings.stickerImgUrl); setShowPreviewModal(true); }}>
                                        <canvas ref={smallStickerCanvasRef} className="w-full h-full object-contain" />
                                   </div>
                                   <div className="flex-1 flex flex-col justify-center space-y-4">
                                       <div className="flex items-center text-xs text-gray-500"><span className="w-8 text-right mr-3">大小</span> <input type="range" min="10" max="200" value={settings.stickerSize} onChange={(e) => updateSetting('stickerSize', parseInt(e.target.value))} className="flex-1" /></div>
                                       <div className="flex items-center text-xs text-gray-500"><span className="w-8 text-right mr-3">左右</span> <input type="range" min="0" max="100" value={settings.stickerX} onChange={(e) => updateSetting('stickerX', parseInt(e.target.value))} className="flex-1" /></div>
                                       <div className="flex items-center text-xs text-gray-500"><span className="w-8 text-right mr-3">上下</span> <input type="range" min="0" max="100" value={settings.stickerY} onChange={(e) => updateSetting('stickerY', parseInt(e.target.value))} className="flex-1" /></div>
                                   </div>
                               </div>
                            )}
                          </div>
                        )}
                    </div>
                    <div className="p-4 pt-0 grid grid-cols-2 gap-3 bg-white pb-4">
                        <button onClick={() => runGeneration('apply')} className="py-3 rounded-xl bg-[#007AFF]/10 active:bg-[#007AFF]/20 text-[#007AFF] font-bold text-[15px] transition-all flex items-center justify-center gap-1">✨ 生成/更新</button>
                        <button onClick={() => runGeneration('repack')} className="py-3 rounded-xl bg-[#FF3B30]/10 active:bg-[#FF3B30]/20 text-[#FF3B30] font-bold text-[15px] transition-all flex items-center justify-center gap-1">🔄 剔除并重排</button>
                    </div>
                </div>
            </details>
        </div>

        {/* Result Area */}
        {generatedBlobs.length > 0 && (
          <div id="resultArea" className="pb-10 animate-fade-in">
            <div className="ios-card">
                <details className="group" open id="resultDetails">
                    <summary className="flex items-center justify-between p-4 bg-white cursor-pointer select-none active:bg-gray-50 transition">
                        <div>
                            <div className="text-[17px] font-bold text-[#34C759]">生成结果</div>
                            <div className="text-[10px] text-gray-400 mt-0.5">预览与下载拼图</div>
                        </div>
                        <svg className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </summary>
                    
                    <div className="border-t border-gray-100 p-4">
                        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                            <div className="flex justify-between items-center font-bold border-b border-green-200/50 pb-2 mb-2">
                                <span className="flex items-center gap-1">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                    生成完成
                                </span>
                                <span>{(generatedBlobs.reduce((acc,b) => acc + b.size, 0) / 1024 / 1024).toFixed(2)} MB</span>
                            </div>
                            <div className="pt-1 text-xs text-green-700 grid grid-cols-2 gap-y-1">
                                {generatedBlobs.map((blob, i) => (
                                    <div key={i} className="px-2"><span className="opacity-70">分组 {i+1}:</span> <span className="font-bold">{(blob.size/1024/1024).toFixed(2)} MB</span></div>
                                ))}
                            </div>
                        </div>
                        
                        <details className="group/preview border border-gray-200 rounded-xl overflow-hidden bg-white mb-4" open>
                            <summary className="p-3 bg-gray-50 text-xs font-bold text-gray-500 flex justify-between items-center cursor-pointer hover:bg-gray-100 transition">
                                <span>🖼️ 图片预览区域 (点击折叠)</span>
                                <svg className="w-3 h-3 text-gray-400 group-open/preview:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            </summary>
                            <div className="result-scroll-container bg-gray-50/50">
                                <div id="seamlessContainer" className="w-full flex flex-col bg-white shadow-sm">
                                    {generatedBlobs.map((blob, i) => (
                                        <img key={i} src={URL.createObjectURL(blob)} className="w-full block border-b border-gray-100 last:border-0" alt={`result-${i}`} />
                                    ))}
                                </div>
                            </div>
                        </details>

                        <details className="mt-4 bg-gray-50 rounded-xl border border-gray-200 group/combine">
                            <summary className="flex items-center justify-between p-3 cursor-pointer select-none">
                                <div>
                                    <div className="text-sm font-bold text-gray-700">长图合并设置</div>
                                    <div className="text-[10px] text-gray-400">将上方生成的多组拼图再次拼接</div>
                                </div>
                                <svg className="w-4 h-4 text-gray-400 group-open/combine:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            </summary>
                            <div className="p-3 pt-0 border-t border-gray-100 mt-2">
                                <div className="grid grid-cols-2 gap-3 mb-3 mt-3">
                                    <div className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-gray-100 shadow-sm">
                                        <span className="text-xs text-gray-500">合并列数</span>
                                        <input type="number" min="1" max="10" value={settings.combineCols} onChange={(e) => updateSetting('combineCols', e.target.value === '' ? '' : parseInt(e.target.value))} className="w-12 text-right text-sm font-bold text-[#007AFF] outline-none" />
                                    </div>
                                    <div className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-gray-100 shadow-sm">
                                        <span className="text-xs text-gray-500">合并行数</span>
                                        <input type="number" min="0" max="100" placeholder="自动" value={settings.combineRows} onChange={(e) => updateSetting('combineRows', e.target.value === '' ? '' : parseInt(e.target.value))} className="w-12 text-right text-sm font-bold text-[#007AFF] outline-none" />
                                    </div>
                                    <div className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-gray-100 shadow-sm col-span-2">
                                        <span className="text-xs text-gray-500">合并间距</span>
                                        <input type="number" min="0" max="500" value={settings.combineGap} onChange={(e) => updateSetting('combineGap', e.target.value === '' ? '' : parseInt(e.target.value))} className="w-12 text-right text-sm font-bold text-[#007AFF] outline-none" />
                                    </div>
                                </div>
                                
                                {combinedImageBlob && (
                                    <div className="mb-3 border border-gray-200 rounded-lg overflow-hidden bg-white">
                                        <div className="p-2 bg-gray-100 text-xs text-gray-500 font-bold text-center border-b border-gray-200">合并预览</div>
                                        <div className="max-h-[500px] overflow-y-auto overflow-x-hidden bg-gray-50">
                                            <img src={URL.createObjectURL(combinedImageBlob)} className="w-full h-auto block" alt="Combined Preview" />
                                        </div>
                                    </div>
                                )}

                                <div className="flex gap-2">
                                    <button onClick={generateCombinedImage} className="flex-1 bg-[#007AFF]/10 text-[#007AFF] border border-[#007AFF]/20 text-[14px] font-bold py-2.5 rounded-lg active:scale-[0.98] transition flex items-center justify-center gap-1">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                        <span>生成合并长图</span>
                                    </button>
                                    {combinedImageBlob && (
                                        <button onClick={downloadCombinedImage} className="flex-1 bg-[#007AFF] text-white text-[14px] font-bold py-2.5 rounded-lg active:scale-[0.98] transition flex items-center justify-center gap-1 shadow-md shadow-blue-500/20">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                            <span>下载长图</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </details>

                        <div className="grid grid-cols-2 gap-3 mt-4">
                            <button onClick={() => handleDownload('parts')} className="col-span-2 bg-[#34C759] text-white text-[16px] font-bold py-4 rounded-xl shadow-lg active:scale-[0.98] transition flex items-center justify-center gap-2">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                <span>逐张下载所有图片 (防漏图版)</span>
                            </button>
                            <button onClick={() => handleDownload('zip')} className="col-span-2 bg-white text-[#007AFF] border border-gray-200 text-[14px] font-medium py-3 rounded-xl active:scale-95 transition">打包下载 (ZIP)</button>
                        </div>
                    </div>
                </details>
            </div>
          </div>
        )}

        <div className="py-10 pb-20 text-center">
            <div className="space-y-1">
                <p className="text-xs text-gray-500 font-medium">拼图Ultimate (Pro Max)</p>
                <p className="text-[10px] text-gray-400">Designed by ikko ❗️❗️🈲二传</p>
            </div>
        </div>
      </main>

      {/* Floating Buttons */}
      <div className="fixed bottom-8 left-0 right-0 px-4 z-40 pointer-events-none">
          <button onClick={() => runGeneration('normal')} className="pointer-events-auto w-full max-w-2xl mx-auto bg-white/80 backdrop-blur-md text-black border border-white/40 font-semibold text-[17px] py-3.5 rounded-full shadow-lg active:scale-[0.98] transition flex items-center justify-center gap-2">
              <span>✨ 开始生成拼图</span>
          </button>
      </div>

      {/* Floating Note Button */}
      {!localStorage.getItem(NOTE_KEY) && (
        <div className="fixed right-5 bottom-28 z-40 transition-all duration-300 hover:scale-105">
            <button onClick={() => setShowNoteModal(true)} className="bg-white/90 backdrop-blur-md text-[#007AFF] shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-white/50 font-bold text-[13px] px-4 py-2.5 rounded-full flex items-center gap-1.5 active:scale-95 transition">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <span>注意事项</span>
            </button>
        </div>
      )}

      {/* Modal: Preview */}
      {showPreviewModal && previewImgSrc && (
        <div className="modal-overlay" onClick={() => setShowPreviewModal(false)}>
             <div className="bg-white p-2 rounded-xl overflow-hidden shadow-2xl relative flex items-center justify-center flex-col max-w-[90%] max-h-[80%]" onClick={(e) => e.stopPropagation()}>
                 <img src={previewImgSrc} className="object-contain max-w-full max-h-[70vh]" alt="preview" />
                 <button onClick={() => setShowPreviewModal(false)} className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-8 h-8 flex items-center justify-center">×</button>
             </div>
        </div>
      )}

      {/* Action Sheet */}
      {showImageAction && (
        <>
            <div className="modal-overlay" onClick={() => setShowImageAction(false)}></div>
            <div className={`action-sheet ${showImageAction ? 'show' : ''}`}>
                <div className="text-center text-gray-400 text-sm mb-4 font-medium">图片操作</div>
                <div className="space-y-3">
                    <button onClick={() => replaceInputRef.current?.click()} className="w-full bg-white text-[#007AFF] font-bold text-[17px] py-3.5 rounded-xl shadow-sm active:bg-gray-50">替换图片</button>
                    <button onClick={deleteImage} className="w-full bg-white text-[#FF3B30] font-bold text-[17px] py-3.5 rounded-xl shadow-sm active:bg-gray-50">删除图片</button>
                </div>
                <button onClick={() => setShowImageAction(false)} className="w-full bg-white text-black font-semibold text-[17px] py-3.5 rounded-xl shadow-sm mt-4 active:bg-gray-50">取消</button>
            </div>
        </>
      )}

      {/* Reset Alert */}
      {showResetAlert && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center">
              <div className="absolute inset-0 bg-black/40" onClick={() => setShowResetAlert(false)}></div>
              <div className="relative bg-[#F2F2F2]/85 backdrop-blur-xl rounded-[14px] w-[270px] text-center shadow-2xl overflow-hidden animate-fade-in">
                  <div className="pt-5 px-4 pb-4">
                      <h3 className="text-[17px] font-bold text-black mb-1">⚠️ 警告</h3>
                      <p className="text-[13px] text-black leading-snug">确定要重置吗？<br/>这将清空所有内容。</p>
                  </div>
                  <div className="flex border-t border-[#3C3C43]/30 h-[44px]">
                      <button onClick={() => setShowResetAlert(false)} className="flex-1 text-[17px] text-[#007AFF] font-normal active:bg-gray-200/50 transition border-r border-[#3C3C43]/30">取消</button>
                      <button onClick={() => { localStorage.removeItem(SETTINGS_KEY); clearImagesDB(); window.location.reload(); }} className="flex-1 text-[17px] text-[#FF3B30] font-bold active:bg-gray-200/50 transition">重置</button>
                  </div>
              </div>
          </div>
      )}

      {/* Note Modal */}
      {showNoteModal && (
        <div className="modal-overlay" onClick={() => setShowNoteModal(false)}>
            <div className="bg-white w-[85%] max-w-[320px] rounded-2xl p-6 relative shadow-2xl animate-fade-in" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-[#007AFF]">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                    <h3 className="text-[18px] font-bold text-gray-900">使用须知</h3>
                </div>
                <div className="text-[14px] text-gray-600 leading-relaxed mb-6 space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                    <p>1. 建议使用 <b>Edge / Chrome</b></p>
                    <p>2. 禁止<b>二传</b>，不经过同意二传发现会删链接的</p>
                    <p>3. 多图一定要调一下画质，建议50%左右。</p>
                     <p>4. 图片数量多时候建议把 <b>已导入图片折叠</b>避免卡顿</p>
                </div>
                <div className="flex items-center gap-3 mt-2">
                    <button onClick={() => { localStorage.setItem(NOTE_KEY, 'true'); setShowNoteModal(false); }} className="text-xs text-gray-400 font-medium py-2 px-2 active:text-gray-600 transition">不再显示</button>
                    <button onClick={() => setShowNoteModal(false)} className="flex-1 bg-[#007AFF] text-white text-[15px] font-bold py-3 rounded-xl shadow-lg shadow-blue-500/30 active:scale-95 transition">我知道了</button>
                </div>
            </div>
        </div>
      )}

      {/* Update Notice Modal */}
      {showUpdateModal && (
        <div className="modal-overlay" style={{ zIndex: 200 }} onClick={() => setShowUpdateModal(false)}>
            <div className="bg-white w-[85%] max-w-[320px] rounded-2xl p-6 relative shadow-2xl animate-fade-in" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-[#34C759]">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"></path></svg>
                    </div>
                    <h3 className="text-[18px] font-bold text-gray-900">优化公告</h3>
                </div>
                <div className="text-[14px] text-gray-600 leading-relaxed mb-6 space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                    <p className="font-bold text-black">V4.0 Pro Max ✨ ：</p>
                    <ul className="list-disc pl-4 space-y-1">
                        <li><p> 图片数量多时候建议把 <b>已导入图片折叠</b>避免卡顿</p></li>
                        <li><b>断点续存</b>：自动保存导入的图片，刷新不丢失。</li>
                        <li><b>字重选择</b>：新增字体粗细调节。</li>
                        <li><b>实时预览</b>：打码与贴纸支持实时预览调整。</li>
                        <li><b>界面升级</b>：覆盖层与画质独立分组，操作更便捷。</li>
                    </ul>
                </div>
                <div className="flex items-center gap-3 mt-2">
                    <button onClick={() => { localStorage.setItem(UPDATE_KEY, 'true'); setShowUpdateModal(false); }} className="text-xs text-gray-400 font-medium py-2 px-2 active:text-gray-600 transition">不再提示</button>
                    <button onClick={() => setShowUpdateModal(false)} className="flex-1 bg-[#34C759] text-white text-[15px] font-bold py-3 rounded-xl shadow-lg shadow-green-500/30 active:scale-95 transition">开始体验</button>
                </div>
            </div>
        </div>
      )}

    </div>
  );
}

export default App;
