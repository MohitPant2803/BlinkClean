import * as MediaLibrary from 'expo-media-library';

export const requestGalleryPermission = async () => {
  try {
    const existingPermission = await MediaLibrary.getPermissionsAsync();
    if (existingPermission.granted) {
      return true;
    }

    const { status } = await MediaLibrary.requestPermissionsAsync(false);
    return status === 'granted';
  } catch (error) {
    // Fail silently to maintain the calm environment
    return false;
  }
};
