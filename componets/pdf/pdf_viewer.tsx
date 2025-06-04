'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { Viewer, Worker, SpecialZoomLevel } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import { zoomPlugin } from '@react-pdf-viewer/zoom';

import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';

const workerUrl = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

interface PdfViewerDisplayProps {
    pdfUrl: string;
    onPageContainerRefsChange: (refs: Record<number, HTMLDivElement | null>) => void;
}

const PdfViewerDisplay: React.FC<PdfViewerDisplayProps> = ({ pdfUrl, onPageContainerRefsChange }) => {
    const defaultLayoutPluginInstance = defaultLayoutPlugin();
    const zoomPluginInstance = zoomPlugin();
    const observerRef = useRef<MutationObserver | null>(null);
    const currentRefsSentToParent = useRef<Record<number, HTMLDivElement | null>>({});

    const handleMutations = useCallback((mutationsList: MutationRecord[], observer: MutationObserver) => {
        console.log('[PdfViewerDisplay] MutationObserver callback triggered. Mutations:', mutationsList.length);

        const newRefs: Record<number, HTMLDivElement | null> = {};
        const currentPageElements = document.querySelectorAll('.rpv-core__inner-page');
        console.log(`[PdfViewerDisplay] Found ${currentPageElements.length} .rpv-core__inner-page elements in current DOM.`);

        if (currentPageElements.length === 0) {
            console.log(`[PdfViewerDisplay] No page elements found, sending empty refs object`);
            if (Object.keys(currentRefsSentToParent.current).length > 0) {
                onPageContainerRefsChange({});
                currentRefsSentToParent.current = {};
            }
            return;
        }

        currentPageElements.forEach((element) => {
            const ariaLabel = element.getAttribute('aria-label');
            let pageIndex = -1;

            if (ariaLabel && ariaLabel.startsWith('Page ')) {
                const pageNumString = ariaLabel.replace('Page ', '').trim();
                const parsedNum = parseInt(pageNumString, 10);

                if (!isNaN(parsedNum) && parsedNum >= 1) {
                    pageIndex = parsedNum - 1;
                }
            }

            if (pageIndex !== -1) {
                newRefs[pageIndex] = element as HTMLDivElement;
            } else {
                console.warn(`[PdfViewerDisplay] Could not extract valid page index from aria-label: "${ariaLabel}" for element:`, element);
            }
        });

        const currentKeys = Object.keys(newRefs).sort().join(',');
        const previousKeys = Object.keys(currentRefsSentToParent.current).sort().join(',');

        if (currentKeys !== previousKeys) {
            console.log(`[PdfViewerDisplay] About to call onPageContainerRefsChange with refs: Found ${Object.keys(newRefs).length} pages`);
            onPageContainerRefsChange(newRefs);
            currentRefsSentToParent.current = newRefs;
        } else {
        }

    }, [onPageContainerRefsChange]);


    useEffect(() => {
        const pollForViewerAndAttachObserver = (attempt = 0, maxAttempts = 50) => {
            const viewerContainer = document.querySelector('.rpv-default-layout__container');

            if (viewerContainer) {
                console.log(`[PdfViewerDisplay] .rpv-default-layout__container found on attempt ${attempt}. Attaching MutationObserver.`);
                observerRef.current = new MutationObserver(handleMutations);
                observerRef.current.observe(viewerContainer, { childList: true, subtree: true });
                handleMutations([], observerRef.current);
            } else if (attempt < maxAttempts) {
                console.log(`[PdfViewerDisplay] .rpv-default-layout__container not found yet. Retrying in 200ms... (Attempt ${attempt + 1}/${maxAttempts})`);
                setTimeout(() => pollForViewerAndAttachObserver(attempt + 1, maxAttempts), 200);
            } else {
                console.error('[PdfViewerDisplay] Failed to find .rpv-default-layout__container after maximum attempts. Overlays might not attach correctly. Please check PDF viewer rendering and selector.');
            }
        };

        pollForViewerAndAttachObserver();

        return () => {
            console.log('[PdfViewerDisplay] PdfViewerDisplay unmounting. Disconnecting observer.');
            if (observerRef.current) {
                observerRef.current.disconnect();
            }
            currentRefsSentToParent.current = {};
        };
    }, [handleMutations]);


    return (
        <div className="h-full w-full flex items-center justify-center bg-white">
            <div className="h-full w-full">
                <Worker workerUrl={workerUrl}>
                    <Viewer
                        fileUrl={pdfUrl}
                        plugins={[defaultLayoutPluginInstance, zoomPluginInstance]}
                        defaultScale={1.0}
                    />
                </Worker>
            </div>
        </div>
    );
};

export default PdfViewerDisplay;
