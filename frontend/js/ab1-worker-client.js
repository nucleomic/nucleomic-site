let ab1Worker = null;

function ensureAb1Worker() {
  if (!ab1Worker) {
    ab1Worker = new Worker("js/ab1-preprocess.worker.js");
  }
  return ab1Worker;
}

function preprocessAb1FilesInBrowser(files, options) {
  return new Promise(async (resolve, reject) => {
    const worker = ensureAb1Worker();

    const payloadFiles = [];
    for (const file of files) {
      const buffer = await file.arrayBuffer();
      payloadFiles.push({
        name: file.name,
        buffer
      });
    }

    const handleMessage = (event) => {
      const data = event.data;
      if (data.type === "done") {
        worker.removeEventListener("message", handleMessage);
        resolve(data.payload);
      } else if (data.type === "error") {
        worker.removeEventListener("message", handleMessage);
        reject(new Error(data.message));
      }
    };

    worker.addEventListener("message", handleMessage);

    worker.postMessage({
      type: "preprocess",
      files: payloadFiles,
      options
    });
  });
}