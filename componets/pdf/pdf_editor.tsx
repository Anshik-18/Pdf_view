'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid'; 
import PdfViewerDisplay from './pdf_viewer'; 

import { PDFDocument, rgb } from 'pdf-lib'; 
import { saveAs } from 'file-saver'; 


export type Tool = 'none' | 'blur' | 'erase' | 'addText';


interface Annotation {
    id: string;
    pageIndex: number;
    type: Tool;
    data: any; 
}

interface PdfEditorProps {
    pdfUrl: string;
}

const PdfEditor: React.FC<PdfEditorProps> = ({ pdfUrl }) => {
    const [activeTool, setActiveTool] = useState<Tool>('none');
    const [currentPageIndex, setCurrentPageIndex] = useState<number>(0); 
    const [selectedText, setSelectedText] = useState<string>('');

  
    const pageContainerRefs = useRef<Record<number, HTMLDivElement | null>>({}); 
    const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map()); 
    const contextRefs = useRef<Map<number, CanvasRenderingContext2D>>(new Map()); 
    const annotationsRef = useRef<Map<number, Annotation[]>>(new Map()); 

    const isDrawingRef = useRef(false);
    const startCoordsRef = useRef<{ x: number; y: number } | null>(null);
    const currentCoordsRef = useRef<{ x: number; y: number } | null>(null);

    const viewerContainerRef = useRef<HTMLDivElement>(null);

    const drawBlurOverlay = useCallback((context: CanvasRenderingContext2D, startX: number, startY: number, endX: number, endY: number) => {
        const x = Math.min(startX, endX);
        const y = Math.min(startY, endY);
        const width = Math.abs(startX - endX);
        const height = Math.abs(startY - endY);

        context.filter = 'blur(4px)';

        context.fillStyle = 'rgba(50, 50, 50, 0.85)';
        context.fillRect(x, y, width, height);

        context.filter = 'none';

        console.log(`[PdfEditor] Drawn blurred overlay: x=${x.toFixed(2)}, y=${y.toFixed(2)}, w=${width.toFixed(2)}, h=${height.toFixed(2)}`);
    }, []);

    const drawEraseLine = useCallback((context: CanvasRenderingContext2D, startX: number, startY: number, endX: number, endY: number) => {
        context.strokeStyle = 'white';
        context.lineWidth = 10;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.stroke();
        console.log(`[PdfEditor] Drawn erase line from (${startX.toFixed(2)},${startY.toFixed(2)}) to (${endX.toFixed(2)},${endY.toFixed(2)})`);
    }, []);

    const drawText = useCallback((context: CanvasRenderingContext2D, x: number, y: number, text: string) => {
        context.font = '24px Arial'; // Adjust font as needed
        context.fillStyle = 'blue'; // Text color
        context.fillText(text, x, y);
        console.log(`[PdfEditor] Drawn text "${text}" at (${x.toFixed(2)},${y.toFixed(2)})`);
    }, []);

    // Function to draw a single annotation on its canvas
    const drawAnnotation = useCallback((pageIndex: number, annotation: Annotation) => {
        const context = contextRefs.current.get(pageIndex);
        if (!context) {
            console.warn(`[PdfEditor] No context found for page ${pageIndex} to draw annotation.`);
            return;
        }
        const canvas = canvasRefs.current.get(pageIndex);
        if (!canvas) {
            console.warn(`[PdfEditor] No canvas found for page ${pageIndex} to draw annotation.`);
            return;
        }

        context.globalCompositeOperation = 'source-over';

        if (annotation.type === 'blur') {
            const { startX, startY, endX, endY } = annotation.data;
            drawBlurOverlay(context, startX, startY, endX, endY);
        } else if (annotation.type === 'erase') {
            const { path } = annotation.data;
            context.strokeStyle = 'white';
            context.lineWidth = 10;
            context.lineCap = 'round';
            context.beginPath();
            if (path.length > 0) {
                context.moveTo(path[0].x, path[0].y);
                for (let i = 1; i < path.length; i++) {
                    context.lineTo(path[i].x, path[i].y);
                }
            }
            context.stroke();
        } else if (annotation.type === 'addText') {
            const { x, y, text } = annotation.data;
            drawText(context, x, y, text);
        }
    }, [drawBlurOverlay, drawEraseLine, drawText]);

    // Function to redraw ALL annotations for a given page
    const redrawPageAnnotations = useCallback((pageIndex: number) => {
        const context = contextRefs.current.get(pageIndex);
        const canvas = canvasRefs.current.get(pageIndex);
        if (!context || !canvas) {
            return;
        }
        context.clearRect(0, 0, canvas.width, canvas.height);
        const pageAnnotations = annotationsRef.current.get(pageIndex) || [];
        pageAnnotations.forEach(ann => drawAnnotation(pageIndex, ann));
    }, [drawAnnotation]);

    // --- Callbacks from PdfViewerDisplay ---
    const handlePageContainerRefsChange = useCallback((refs: Record<number, HTMLDivElement | null>) => {
        console.log('[PdfEditor] handlePageContainerRefsChange called with refs:', {
            totalPages: Object.keys(refs).length,
            pageIndices: Object.keys(refs).map(Number).sort((a, b) => a - b),
          
        });
        pageContainerRefs.current = refs;
    }, []);

   
    useEffect(() => {
        console.log('[PdfEditor] Canvas lifecycle effect triggered. Managing canvases...');
        const currentKnownPageIndices = Object.keys(pageContainerRefs.current).map(Number);
        const currentActiveCanvasIndices = new Set(canvasRefs.current.keys());

     
        currentKnownPageIndices.forEach(pageIndex => {
            const pageElement = pageContainerRefs.current[pageIndex];
            if (pageElement) {
               
                let customCanvas = canvasRefs.current.get(pageIndex);
                let targetParent = pageElement.querySelector('.rpv-core__page-layer') as HTMLDivElement;

                if (!targetParent) {
                    console.warn(`[PdfEditor] .rpv-core__page-layer not found for page ${pageIndex}. Appending canvas directly to .rpv-core__inner-page.`);
                    targetParent = pageElement; 
                }

                if (!customCanvas) {
                    
                    customCanvas = document.createElement('canvas');
                    customCanvas.classList.add('custom-annotation-canvas'); 
                    console.log(`[PdfEditor] Creating new canvas for page ${pageIndex}`);

                  
                    if (targetParent && (!customCanvas.parentElement || customCanvas.parentElement !== targetParent)) {
                        targetParent.appendChild(customCanvas);
                        console.log(`[PdfEditor] Appended new canvas for page ${pageIndex} to parent: ${targetParent.className || targetParent.tagName}.`);
                    }

                    
                    canvasRefs.current.set(pageIndex, customCanvas);
                    const context = customCanvas.getContext('2d');
                    if (context) {
                        contextRefs.current.set(pageIndex, context);
                    } else {
                        console.error(`[PdfEditor] Failed to get 2D context for canvas on page ${pageIndex}.`);
                        return; 
                    }
                } else {
                 
                    if (!customCanvas.parentElement || customCanvas.parentElement !== targetParent) {
                        console.warn(`[PdfEditor] Canvas for page ${pageIndex} found in refs but not correctly parented. Re-appending.`);
                        targetParent.appendChild(customCanvas);
                    }
                }

         
                const canvas = canvasRefs.current.get(pageIndex)!;
                const context = contextRefs.current.get(pageIndex)!; 

                canvas.width = pageElement.offsetWidth;
                canvas.height = pageElement.offsetHeight;
                canvas.style.position = 'absolute';
                canvas.style.top = '0';
                canvas.style.left = '0';
                canvas.style.zIndex = '5'; // Ensure it's above the PDF content

                const isDrawingTool = (activeTool === 'blur' || activeTool === 'erase' || activeTool === 'addText');
                canvas.style.pointerEvents = isDrawingTool ? 'auto' : 'none';
                canvas.style.cursor = (activeTool === 'blur' || activeTool === 'erase') ? 'crosshair' : (activeTool === 'addText' ? 'text' : 'default');

                console.log(`[PdfEditor] Canvas ${pageIndex} updated: ${canvas.width}x${canvas.height}, zIndex: ${canvas.style.zIndex}, pointerEvents: ${canvas.style.pointerEvents}, cursor: ${canvas.style.cursor}`);

                redrawPageAnnotations(pageIndex); // Redraw all annotations for this page
            }
        });

      
        currentActiveCanvasIndices.forEach(pageIndex => {
            if (!pageContainerRefs.current[pageIndex]) {
                const canvasToRemove = canvasRefs.current.get(pageIndex);
                if (canvasToRemove) {
                    console.log(`[PdfEditor] Removing canvas for page ${pageIndex}.`);
                    canvasToRemove.remove(); // Remove the DOM element
                    canvasRefs.current.delete(pageIndex);
                    contextRefs.current.delete(pageIndex);
                    annotationsRef.current.delete(pageIndex); // Also clear annotations for removed pages
                }
            }
        });

    }, [pageContainerRefs.current, activeTool, redrawPageAnnotations]);


    const handleToolInteraction = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (activeTool === 'none') return;

        const targetElement = event.target as HTMLElement;

        const pageElement = targetElement.closest('.rpv-core__inner-page') as HTMLDivElement;
        if (!pageElement) {
            return;
        }

        // Extract pageIndex from aria-label
        const ariaLabel = pageElement.getAttribute('aria-label');
        let pageIndex = -1;
        if (ariaLabel && ariaLabel.startsWith('Page ')) {
            pageIndex = parseInt(ariaLabel.replace('Page ', '')) - 1;
        }

        if (pageIndex === -1) {
            console.error('[PdfEditor] handleToolInteraction: Could not determine pageIndex for clicked page element.');
            return;
        }

        const canvas = canvasRefs.current.get(pageIndex);
        const context = contextRefs.current.get(pageIndex);

        if (!canvas || !context) {
            console.error(`[PdfEditor] handleToolInteraction: Canvas or context not found for page ${pageIndex}.`);
            return;
        }

      
        const rect = canvas.getBoundingClientRect();
        const canvasX = event.clientX - rect.left;
        const canvasY = event.clientY - rect.top;

        // Ensure coordinates are within canvas bounds
        const boundedCanvasX = Math.max(0, Math.min(canvasX, canvas.width));
        const boundedCanvasY = Math.max(0, Math.min(canvasY, canvas.height));

        console.log(`[PdfEditor] Mouse event on page ${pageIndex}: Type=${event.type}, Coords=(Canvas: ${canvasX.toFixed(2)}, ${canvasY.toFixed(2)} | Bounded: ${boundedCanvasX.toFixed(2)}, ${boundedCanvasY.toFixed(2)})`);


        if (event.type === 'mousedown') {
            isDrawingRef.current = true;
            startCoordsRef.current = { x: boundedCanvasX, y: boundedCanvasY };
            currentCoordsRef.current = { x: boundedCanvasX, y: boundedCanvasY };
            console.log(`[PdfEditor] Mousedown: Starting drawing at (${boundedCanvasX.toFixed(2)}, ${boundedCanvasY.toFixed(2)})`);

        } else if (event.type === 'mousemove' && isDrawingRef.current) {
            currentCoordsRef.current = { x: boundedCanvasX, y: boundedCanvasY };
          

            redrawPageAnnotations(pageIndex); 

            if (activeTool === 'blur' && startCoordsRef.current) {
                drawBlurOverlay(context, startCoordsRef.current.x, startCoordsRef.current.y, boundedCanvasX, boundedCanvasY);
            } else if (activeTool === 'erase' && startCoordsRef.current) {
                
                const pageAnnotations = annotationsRef.current.get(pageIndex) || [];
                const lastAnnotation = pageAnnotations[pageAnnotations.length - 1];
                if (lastAnnotation && lastAnnotation.type === 'erase' && lastAnnotation.data.path) {
                    lastAnnotation.data.path.push({ x: boundedCanvasX, y: boundedCanvasY });
                } else {
                   
                    annotationsRef.current.set(pageIndex, [...pageAnnotations, {
                        id: uuidv4(),
                        pageIndex,
                        type: 'erase',
                        data: { path: [{ x: startCoordsRef.current.x, y: startCoordsRef.current.y }, { x: boundedCanvasX, y: boundedCanvasY }] }
                    }]);
                }
                redrawPageAnnotations(pageIndex); 
               
            }

        } else if (event.type === 'mouseup') {
            isDrawingRef.current = false;
            console.log(`[PdfEditor] Mouseup: Ending drawing.`);

            const startX = startCoordsRef.current?.x;
            const startY = startCoordsRef.current?.y;
            const endX = boundedCanvasX;
            const endY = boundedCanvasY;

            if (typeof startX === 'number' && typeof startY === 'number') {
                let newAnnotation: Annotation | null = null;

                if (activeTool === 'blur') {
                    
                    if (Math.abs(startX! - endX) > 5 || Math.abs(startY! - endY) > 5) {
                        newAnnotation = {
                            id: uuidv4(),
                            pageIndex: pageIndex,
                            type: 'blur',
                            data: { startX, startY, endX, endY }
                        };
                    } else {
                        console.log('[PdfEditor] Small drag for blur, not creating annotation.');
                    }
                } else if (activeTool === 'erase') {
                    
                    console.log('[PdfEditor] Erase action completed.');
                } else if (activeTool === 'addText') {
                    const textContent = prompt("Enter text:");
                    if (textContent) {
                        newAnnotation = {
                            id: uuidv4(),
                            pageIndex: pageIndex,
                            type: 'addText',
                            data: { x: endX, y: endY, text: textContent }
                        };
                    }
                }

                if (newAnnotation) {
                    const pageAnnotations = annotationsRef.current.get(pageIndex) || [];
                    annotationsRef.current.set(pageIndex, [...pageAnnotations, newAnnotation]);
                    console.log(`[PdfEditor] Added new annotation for page ${pageIndex}:`, newAnnotation);
                }
            } else {
                console.warn(`[PdfEditor] Mouseup: startCoordsRef was null or invalid. No annotation created.`);
            }

            startCoordsRef.current = null;
            currentCoordsRef.current = null;
            redrawPageAnnotations(pageIndex); 
        }
    }, [activeTool, redrawPageAnnotations, drawBlurOverlay, drawEraseLine, drawText]);

  
    useEffect(() => {
        const viewerContainer = viewerContainerRef.current;

        const handleTextSelection = () => {
            // Only capture selection if no drawing tool is active
            if (activeTool === 'none') {
                const selection = window.getSelection();
                const text = selection?.toString().trim();
                if (text && text.length > 0) {
                    console.log('[PdfEditor] Text selected:', text);
                    setSelectedText(text);
                } else if (!text && selectedText) {
                     console.log('[PdfEditor] Text selection cleared.');
                     setSelectedText('');
                }
            } else if (selectedText) {
                 console.log('[PdfEditor] Clearing selected text due to tool activation.');
                 setSelectedText('');
            }
        };

        if (viewerContainer) {
            viewerContainer.addEventListener('mouseup', handleTextSelection);
        }

        return () => {
            if (viewerContainer) {
                viewerContainer.removeEventListener('mouseup', handleTextSelection);
            }
        };
    }, [activeTool, selectedText]); 

    const handleToolChange = useCallback((tool: Tool) => {
        console.log(`[PdfEditor] Updating tool state to: ${tool}`);
        setActiveTool(tool);

        if (selectedText) {
            console.log('[PdfEditor] Clearing selected text on tool change.');
            setSelectedText('');
        }

        const isDrawingTool = (tool === 'blur' || tool === 'erase' || tool === 'addText');
        const canvasPointerEvents = isDrawingTool ? 'auto' : 'none';
        const canvasCursor = (tool === 'blur' || tool === 'erase') ? 'crosshair' : (tool === 'addText' ? 'text' : 'default');
        const textLayerPointerEvents = isDrawingTool ? 'none' : 'auto';

        canvasRefs.current.forEach((canvas, pageIndex) => {
            console.log(`[PdfEditor] handleToolChange: Canvas ${pageIndex} - Attempting to set pointerEvents from ${canvas.style.pointerEvents} to ${canvasPointerEvents}`);
            canvas.style.pointerEvents = canvasPointerEvents;
            canvas.style.cursor = canvasCursor;
            console.log(`[PdfEditor] handleToolChange: Canvas ${pageIndex} - pointerEvents set to ${canvas.style.pointerEvents}, cursor set to ${canvas.style.cursor}`);

            const pageElement = pageContainerRefs.current[pageIndex];
            if (pageElement) {
                const textLayer = pageElement.querySelector('.rpv-core__text-layer') as HTMLDivElement;
                if (textLayer) {
                    textLayer.style.pointerEvents = textLayerPointerEvents;
                    console.log(`[PdfEditor] Page ${pageIndex} text layer: pointerEvents=${textLayerPointerEvents}`);
                } else {
                    console.warn(`[PdfEditor] handleToolChange: rpv-core__text-layer not found for page ${pageIndex}.`);
                }
            }
        });

        if (!isDrawingTool) {
            isDrawingRef.current = false;
            startCoordsRef.current = null;
            currentCoordsRef.current = null;
        }
    }, [pageContainerRefs, selectedText]); 

    const handleDownload = async () => {
        console.log('[PdfEditor] Initiating PDF download...');

        if (!pdfUrl) {
            console.error('[PdfEditor] No PDF URL available for download.');
            return;
        }

        try {
            const originalPdfBytes = await fetch(pdfUrl).then(res => res.arrayBuffer());
            const pdfDoc = await PDFDocument.load(originalPdfBytes);

            const pages = pdfDoc.getPages();

            for (let i = 0; i < pages.length; i++) {
                const page = pages[i];
                const annotationsOnPage = annotationsRef.current.get(i);
                const canvasForPage = canvasRefs.current.get(i);

                if (canvasForPage && annotationsOnPage && annotationsOnPage.length > 0) {
                    console.log(`[PdfEditor] Processing page ${i + 1} with ${annotationsOnPage.length} annotations.`);

                   
                    const canvasImageBytes = await fetch(canvasForPage.toDataURL()).then(res => res.arrayBuffer());

                    const embeddedImage = await pdfDoc.embedPng(canvasImageBytes);

                    const { width, height } = page.getSize();

                    page.drawImage(embeddedImage, {
                        x: 0,
                        y: 0,
                        width: width,
                        height: height,
                    });

                    console.log(`[PdfEditor] Applied annotations from canvas to page ${i + 1}.`);

                } else {
                    console.log(`[PdfEditor] No annotations or canvas found for page ${i + 1}. Skipping.`);
                }
            }

          
            const modifiedPdfBytes = await pdfDoc.save();

       
            const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
            saveAs(blob, 'edited-document.pdf');

            console.log('[PdfEditor] PDF download complete.');

        } catch (error) {
            console.error('[PdfEditor] Error during PDF download:', error);
        }
    };


    const handleSearchChatGPT = () => {
        if (selectedText) {
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(selectedText + ' ChatGPT')}`;
            window.open(searchUrl, '_blank');
            console.log('[PdfEditor] Searching Google (for ChatGPT context) for:', selectedText);
             const selection = window.getSelection();
             if (selection) {
                 selection.removeAllRanges();
                 setSelectedText(''); // Clear state as well
             }
        }
    };

    // --- Main Component Render ---
    return (
        <div className="max-w-4xl mx-auto h-full w-full">
            <div className="flex h-full w-full bg-white rounded-lg shadow-md">
                <div
                    ref={viewerContainerRef} 
                    className="flex-grow relative h-full"
                    onMouseDown={handleToolInteraction}
                    onMouseMove={handleToolInteraction}
                    onMouseUp={handleToolInteraction} 
                    onMouseLeave={() => {
                        if (isDrawingRef.current) {
                            console.log('[PdfEditor] Mouse left viewer during drag. Resetting drawing state.');
                            isDrawingRef.current = false;
                            startCoordsRef.current = null;
                            currentCoordsRef.current = null;
                            canvasRefs.current.forEach((canvas, pageIndex) => {
                                redrawPageAnnotations(pageIndex);
                            });
                        }
                    }}
                >
                    <PdfViewerDisplay
                        pdfUrl={pdfUrl}
                        onPageContainerRefsChange={handlePageContainerRefsChange}
                    />
                </div>
                <div className="w-48 p-4 border-l border-gray-200 bg-gray-50 flex-shrink-0">
                    <h3>Tools</h3>
                    <button
                        onClick={() => handleToolChange('blur')}
                        className={`w-full mb-2 px-3 py-2 rounded-md transition-colors text-left
                            ${activeTool === 'blur' ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}
                        `}
                    >
                        Blur
                    </button>
                    <button
                        onClick={() => handleToolChange('erase')}
                        className={`w-full mb-2 px-3 py-2 rounded-md transition-colors text-left
                            ${activeTool === 'erase' ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}
                        `}
                    >
                        Erase
                    </button>
                    <button
                        onClick={() => handleToolChange('addText')}
                        className={`w-full mb-2 px-3 py-2 rounded-md transition-colors text-left
                            ${activeTool === 'addText' ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}
                        `}
                    >
                        Add Text
                    </button>
                    <button
                        onClick={() => handleToolChange('none')}
                        className={`w-full mb-2 px-3 py-2 rounded-md transition-colors text-left
                            ${activeTool === 'none' ? 'bg-red-500 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}
                        `}
                    >
                        Select/View
                    </button>

                    {selectedText && (
                         <div className="mt-4 pt-4 border-t border-gray-200">
                             <button
                                onClick={handleSearchChatGPT}
                                className="w-full px-3 py-2 rounded-md bg-purple-500 text-white hover:bg-purple-600 transition-colors text-left"
                             >
                                Search Google
                             </button>
                         </div>
                    )}

                    <div className="mt-4 pt-4 border-t border-gray-200">
                         <button
                            onClick={handleDownload}
                            className="w-full px-3 py-2 rounded-md bg-green-500 text-white hover:bg-green-600 transition-colors text-left"
                         >
                            Download PDF
                         </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PdfEditor;
