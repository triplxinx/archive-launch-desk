self.onmessage = async ({data}) => {
  const {id,blob,crop,scale} = data;
  try {
    const bitmap = await createImageBitmap(blob, {imageOrientation:"from-image"});
    let result;
    try {
      const x = Math.floor(bitmap.width * crop.left / 100);
      const y = Math.floor(bitmap.height * crop.top / 100);
      const width = Math.max(1,Math.min(bitmap.width - x,Math.round(bitmap.width * crop.width / 100)));
      const height = Math.max(1,Math.min(bitmap.height - y,Math.round(bitmap.height * crop.height / 100)));
      const targetWidth = width * scale;
      const targetHeight = height * scale;
      if (targetWidth > 16384 || targetHeight > 16384 || targetWidth * targetHeight > 40000000) {
        throw Error("This edit exceeds the browser’s image budget. Crop tighter, or switch off 4×.");
      }
      const canvas = new OffscreenCanvas(targetWidth,targetHeight);
      const context = canvas.getContext("2d");
      if (!context) throw Error("Image editing is unavailable in this browser.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap,x,y,width,height,0,0,targetWidth,targetHeight);
      result = await canvas.convertToBlob({type:"image/webp",quality:.92});
    } finally {
      bitmap.close();
    }
    self.postMessage({id,blob:result});
  } catch (error) {
    self.postMessage({id,error:error.message || "Could not process image."});
  }
};
