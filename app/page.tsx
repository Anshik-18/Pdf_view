"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

const DynamicPdfEditor = dynamic(() => import("../componets/pdf/pdf_editor"), {
  ssr: false,
});

export default function Home() {
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result) {
        setFileUrl(reader.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <main className="p-4 max-w-4xl mx-auto">
      <h1 className="text-3xl font-extrabold text-gray-800 mb-6 text-center">
        📄 Advanced PDF Editor
      </h1>

      <div className="flex flex-col items-center mb-8 p-4 border rounded-lg shadow-md bg-white">
        <label htmlFor="pdf-upload" className="block text-lg font-medium text-gray-700 mb-2">
          Upload a PDF to start editing:
        </label>
        <input
          id="pdf-upload"
          type="file"
          accept="application/pdf"
          onChange={handleFileUpload}
          className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
        {fileUrl && (
          <p className="mt-2 text-sm text-gray-500">PDF loaded. Start editing below!</p>
        )}
      </div>

      {fileUrl ? (
        <DynamicPdfEditor pdfUrl={fileUrl} />
      ) : (
        <div className="flex justify-center items-center h-64 bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg">
          <p className="text-gray-500 text-lg">No PDF loaded. Please upload a file to begin.</p>
        </div>
      )}
    </main>
  );
}