import * as MediaLibrary from 'expo-media-library';

export const requestGalleryPermission = async () => {
  try {
    const existingPermission = await MediaLibrary.getPermissionsAsync();
    if (existingPermission.granted) {
      return true;
    }

    // Requesting without arguments ensures we ask for standard read/write access
    const { status, canAskAgain } = await MediaLibrary.requestPermissionsAsync();
    
    if (status !== 'granted' && !canAskAgain) {
      console.log("Permission permanently denied. User must enable in OS settings.");
    }

    return status === 'granted';
  } catch (error) {
    // Fail silently to maintain the calm environment
    return false;
  }
};
