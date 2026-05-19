import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Image,
  Animated,
  TouchableOpacity,
  BackHandler,
  FlatList,
  Dimensions,
  Pressable,
  Alert,
  ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, withDelay, withRepeat, withSequence, runOnJS, interpolate, Extrapolation, Easing } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import GhostButton from '../components/GhostButton';
import SwipeableCard from '../components/SwipeableCard';
import { requestGalleryPermission } from '../utils/permissions';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const PhotoCard = memo(({ card, isInspecting }) => {
  const hasLoaded = useRef(false);
  const opacity = useSharedValue(hasLoaded.current ? 1 : 0);
  const scale = useSharedValue(hasLoaded.current ? 1 : 0.95);

  if (!card) return null;
  
  // Determine if the photo is landscape to apply the appropriate cinematic fit
  const isLandscape = card.width > card.height;

  const rStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }]
  }));

  return (
    <View style={styles.card}>
      <View style={styles.cardSkeleton} />
      {/* Cinematic internal blur for a seamless edge-to-edge feel on non-matching aspect ratios */}
      <Image 
        source={{ uri: card.uri }} 
        style={[StyleSheet.absoluteFill, { opacity: 0.4 }]} 
        blurRadius={30} 
        resizeMethod="resize" 
      />
      {!isInspecting && (
        <Reanimated.Image 
          source={{ uri: card.uri }} 
          style={[styles.cardImage, rStyle]}
          resizeMode={isLandscape ? "contain" : "cover"}
          // Downsampled Rendering: Prevents loading the raw 12MP/48MP image into heap,
          // avoiding OOM crashes and massive frame drops by forcing Android 
          // to resize the bitmap in memory.
          resizeMethod="resize"
          sharedTransitionTag={`photo-${card.id}`}
          onLoad={() => {
            if (!hasLoaded.current) {
              hasLoaded.current = true;
              opacity.value = withTiming(1, { duration: 500 });
              scale.value = withSpring(1, { damping: 20, stiffness: 100 });
            }
          }}
        />
      )}
    </View>
  );
});

const TactileButton = memo(({ icon, onPress, disabled }) => {
  return (
    <TouchableOpacity 
      style={[styles.tactileButton, disabled && { opacity: 0.3 }]} 
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <Feather name={icon} size={20} color={disabled ? "#6b7280" : "#f3f4f6"} />
    </TouchableOpacity>
  );
});

const FullscreenViewer = memo(({ photo, onClose }) => {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const bgOpacity = useSharedValue(0);

  useEffect(() => {
    // 2. PREMIUM FULLSCREEN ATMOSPHERE
    // Why environmental dimming improves focus: Gradually shifting the environment to pure
    // dark mode removes all peripheral visual noise, allowing the user's brain to allocate
    // 100% of its visual processing to the emotional content of the photograph.
    bgOpacity.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) });
  }, []);

  const triggerClose = useCallback(() => {
    bgOpacity.value = withTiming(0, { duration: 250 });
    onClose();
  }, [onClose]);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value === 1) {
        // 5. BACKGROUND DEPTH RESPONSE
        // Dragging to dismiss creates physical continuity. By mapping the background
        // opacity and scale directly to the drag distance, the user feels the physical
        // weight of pulling the image back into the stack.
        translateY.value = e.translationY;
        translateX.value = e.translationX;
        const dragDistance = Math.abs(e.translationY);
        bgOpacity.value = Math.max(0, 1 - dragDistance / (SCREEN_HEIGHT * 0.5));
        scale.value = Math.max(0.85, 1 - dragDistance / (SCREEN_HEIGHT * 1.5));
      } else {
        // 4. IMAGE INTERACTION QUALITY (Momentum-aware panning)
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      }
    })
    .onEnd((e) => {
      if (scale.value <= 1) {
        if (Math.abs(e.translationY) > 120 || Math.abs(e.velocityY) > 800) {
          // 3. GESTURE-FIRST EXIT SYSTEM
          // Why gesture-first fullscreen feels modern: It respects the user's motor habits.
          // Swiping down to dismiss is a physically satisfying, universal motion. Relying on
          // tiny hit-targets (like 'X' buttons) breaks immersion and increases cognitive load.
          runOnJS(triggerClose)();
        } else {
          translateY.value = withSpring(0, { damping: 16, stiffness: 200 });
          translateX.value = withSpring(0, { damping: 16, stiffness: 200 });
          scale.value = withSpring(1, { damping: 16, stiffness: 200 });
          bgOpacity.value = withTiming(1, { duration: 250 });
        }
      } else {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      }
    });

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      // 4. IMAGE INTERACTION QUALITY (Buttery pinch-to-zoom)
      scale.value = Math.max(0.8, savedScale.value * e.scale);
    })
    .onEnd(() => {
      if (scale.value < 1) {
        scale.value = withSpring(1, { damping: 16, stiffness: 200 });
        savedScale.value = 1;
        translateX.value = withSpring(0, { damping: 16, stiffness: 200 });
        translateY.value = withSpring(0, { damping: 16, stiffness: 200 });
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        savedScale.value = scale.value;
      }
    });

  const doubleTap = Gesture.Tap().numberOfTaps(2).maxDelay(250).onEnd(() => {
    // 4. IMAGE INTERACTION QUALITY (Double-tap zoom)
    if (scale.value > 1) {
      scale.value = withSpring(1, { damping: 16, stiffness: 200 });
      savedScale.value = 1;
      translateX.value = withSpring(0, { damping: 16, stiffness: 200 });
      translateY.value = withSpring(0, { damping: 16, stiffness: 200 });
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
    } else {
      scale.value = withSpring(2.5, { damping: 16, stiffness: 200 });
      savedScale.value = 2.5;
    }
  });

  // 4. IMAGE INTERACTION QUALITY (Gesture conflict resolution)
  const composed = Gesture.Simultaneous(pan, pinch, doubleTap);

  const rStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value }
    ]
  }));

  const bgStyle = useAnimatedStyle(() => ({
    opacity: bgOpacity.value,
    backgroundColor: '#000000'
  }));

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 1000 }]} pointerEvents="box-none">
      <Reanimated.View style={[StyleSheet.absoluteFill, bgStyle]} pointerEvents="none" />
      <GestureDetector gesture={composed}>
        <Reanimated.View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]} pointerEvents="box-none">
          {/* 1. PHYSICALLY CONNECTED OPEN TRANSITION */}
          {/* Why continuity improves immersion: Using shared transition tags directly links the
              original card to the fullscreen layer. The brain perceives it as the exact same
              object shifting into a focus state, maintaining an unbroken emotional thread. */}
          {/* 6. LOADING + IMAGE OPTIMIZATION */}
          {/* By reusing the exact same image URI that was already decoded in the PhotoCard,
              we avoid bitmap spikes and decode lag entirely. */}
          <Reanimated.Image
            source={{ uri: photo.uri }}
            style={[styles.fullscreenImage, rStyle]}
            resizeMode="contain"
            resizeMethod="resize"
            sharedTransitionTag={`photo-${photo.id}`}
          />
          {/* 7. UI MINIMALISM */}
          {/* Why restrained UI feels more premium: Overlays scream "app". By stripping away
              all navigation chrome and buttons, the image reclaims its status as a piece
              of personal history rather than digital content. */}
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
});

const WelcomeCard = memo(({ activeTranslateX }) => {
  // Interpolate the horizontal drag directly into the tint background
  const rTintStyle = useAnimatedStyle(() => {
    const dX = activeTranslateX.value;
    const progressRight = Math.max(dX / (SCREEN_WIDTH * 0.35), 0);
    const progressLeft = Math.max(-dX / (SCREEN_WIDTH * 0.35), 0);

    const alphaRight = Math.min(progressRight, 1) * 0.15;
    const alphaLeft = Math.min(progressLeft, 1) * 0.15;

    const r = dX < 0 ? 239 : 16;
    const g = dX < 0 ? 68 : 185;
    const b = dX < 0 ? 68 : 129;
    // Format to 3 decimal places to prevent scientific notation stringification (e.g., 1e-7)
    const a = (dX < 0 ? alphaLeft : alphaRight).toFixed(3);

    return { backgroundColor: `rgba(${r}, ${g}, ${b}, ${a})` };
  });

  // Gentle, aesthetic floating bob to bring the card to life
  const floatY = useSharedValue(0);
  useEffect(() => {
    floatY.value = withRepeat(
      withSequence(
        withTiming(-8, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1200, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, []);
  const rFloatStyle = useAnimatedStyle(() => ({ transform: [{ translateY: floatY.value }] }));

  return (
    <View style={styles.welcomeCard}>
      <Reanimated.View style={[StyleSheet.absoluteFill, rTintStyle]} />
      <Reanimated.View style={[styles.welcomeCentralArtUnit, rFloatStyle]}>
        <Feather name="aperture" size={80} color="#F3F4F6" />
        <Text style={styles.welcomeTitle}>BlinkClean</Text>
        <Text style={styles.welcomeSubtitle}>Your photos. Tidy in a blink.</Text>
      </Reanimated.View>
    </View>
  );
});

const ExitThumbnail = memo(({ item, index }) => {
  const opacity = useSharedValue(0);
  useEffect(() => {
    // Stagger the fade-in opacity of individual thumbnails in the track
    opacity.value = withDelay(index * 15, withTiming(1, { duration: 300 }));
  }, []);
  const rStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Reanimated.Image 
      source={{ uri: item.uri }} 
      style={[styles.exitThumbnail, rStyle]} 
      resizeMode="cover"
      resizeMethod="resize"
    />
  );
});

export default function HomeScreen() {
  const [permissionStatus, setPermissionStatus] = useState('checking');
  
  // Persistent swipe memory
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const swipedPhotoIdsRef = useRef(new Set());
  const swipeHistoryRef = useRef([]);
  const saveTimeoutRef = useRef(null);
  const hasSeenOnboardingRef = useRef(false);

  // Clean, separated state as requested
  const [albums, setAlbums] = useState([]);
  const [selectedAlbum, setSelectedAlbum] = useState(null);

  const [allPhotos, setAllPhotos] = useState([]);
  const [visiblePhotos, setVisiblePhotos] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [endCursor, setEndCursor] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(true);
  const [isFetching, setIsFetching] = useState(false);

  const [shouldLoad, setShouldLoad] = useState(false);
  const [isAlbumSwitcherVisible, setIsAlbumSwitcherVisible] = useState(false);

  // Shared value to continuously broadcast stack depth progress to all background cards
  const activeTranslateX = useSharedValue(0);
  const activeTranslateY = useSharedValue(0);

  // Undo System State
  const [undoStack, setUndoStack] = useState([]);
  const [undoOrigin, setUndoOrigin] = useState(null);
  const [undoTargetId, setUndoTargetId] = useState(null);

  // Deletion and Keep Queues
  const [deleteQueue, setDeleteQueue] = useState([]);
  const [keptQueue, setKeptQueue] = useState([]);
  const [isReviewing, setIsReviewing] = useState(false);
  const [deselectedIds, setDeselectedIds] = useState(new Set());

  const [keptCount, setKeptCount] = useState(0);
  const [removedCount, setRemovedCount] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const [isConfiguring, setIsConfiguring] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(null); // 'start' | 'end' | null
  const [sortOrder, setSortOrder] = useState('desc'); // 'desc' | 'asc'
  const [inspectingPhoto, setInspectingPhoto] = useState(null);

  // Bottom Sheet Confirmation States
  const [isExitSheetVisible, setIsExitSheetVisible] = useState(false);
  const exitSheetTranslateY = useSharedValue(SCREEN_HEIGHT);
  const exitSheetOpacity = useSharedValue(0);

  // Cinematic Entry Animation Values
  const appOpacity = useSharedValue(0);
  const contentScale = useSharedValue(0.96);
  const contentTranslateY = useSharedValue(16);
  const secondaryControlsOpacity = useSharedValue(0);
  
  // Cinematic Interaction Transition
  const activeInteraction = useSharedValue(0);

  // Cinematic Idle Breathing Values
  const idleBreathing = useSharedValue(0);

  const resetAndLoad = useCallback(() => {
    setHasLoaded(false);
    setAllPhotos([]);
    setVisiblePhotos([]);
    setCurrentIndex(0);
    setEndCursor(null);
    setHasNextPage(true);
    setShouldLoad(true);
  }, []);

  useEffect(() => {
    if (shouldLoad) {
      setShouldLoad(false);
      fetchPhotos(false);
    }
  }, [shouldLoad, fetchPhotos]);

  useEffect(() => {
    // Why subtle ambient motion improves immersion: A completely static interface feels cold and digital. 
    // Introducing a very slow, microscopic breathing cycle mimics the natural life of physical objects, 
    // making the environment feel alive and responsive.
    // Why stillness can feel dead: Absolute stillness in a dark environment can feel eerie or broken.
    // How subconscious movement affects emotional perception: Movement that is felt rather than seen 
    // calms the user, creating a meditative state suitable for nostalgia and memory review.
    idleBreathing.value = withRepeat(
      withTiming(1, { duration: 8000, easing: Easing.inOut(Easing.sin) }),
      -1, // Infinite
      true // Reverse
    );
  }, [idleBreathing]);

  // Cinematic App Launch Sequence
  useEffect(() => {
    // Why anticipation improves perceived quality: A short delay of pure dark screen before rendering 
    // gives the OS time to settle and builds subconscious anticipation, avoiding the "flash of unstyled content" feel.
    if (isHistoryLoaded && permissionStatus !== 'checking') {
      const delay = 150;
      
      // Why soft emergence feels cinematic: Fading in the background/content slowly, followed by a slight 
      // upward physical emergence (scale + translate) mimics a curtain rising on a physical stage.
      appOpacity.value = withDelay(delay, withTiming(1, { duration: 800 }));
      contentScale.value = withDelay(delay + 100, withTiming(1, { duration: 700 }));
      contentTranslateY.value = withDelay(delay + 100, withTiming(0, { duration: 700 }));
      
      // Why synchronized motion creates polish: Delaying the secondary text slightly after the primary cards 
      // establishes a clear visual hierarchy without distracting the user's focus from the main emotional content.
      secondaryControlsOpacity.value = withDelay(delay + 300, withTiming(1, { duration: 600 }));
    }
  }, [isHistoryLoaded, permissionStatus, appOpacity, contentScale, contentTranslateY, secondaryControlsOpacity]);

  const animatedContentStyle = useAnimatedStyle(() => ({
    opacity: appOpacity.value,
    transform: [
      { scale: contentScale.value },
      { translateY: contentTranslateY.value }
    ]
  }));

  const animatedSecondaryStyle = useAnimatedStyle(() => {
    // Why interaction-state transitions improve immersion: Fading out secondary controls 
    // during the active gesture forces the user's visual focus entirely onto the hero photo. 
    // The interface politely "gets out of the way" when action is taking place.
    return {
      opacity: secondaryControlsOpacity.value * interpolate(activeInteraction.value, [0, 1], [1, 0.3], Extrapolation.CLAMP),
    };
  });

  const animatedDeckBreathingStyle = useAnimatedStyle(() => {
    // Extremely subtle ambient movement & minimal idle card depth movement
    return {
      transform: [
        { translateY: interpolate(idleBreathing.value, [0, 1], [0, 4]) },
        { scale: interpolate(idleBreathing.value, [0, 1], [1, 1.005]) }
      ]
    };
  });

  const atmosphericBackgroundStyle = useAnimatedStyle(() => {
    // Atmospheric focus shift: Deepen the background darkness to isolate the card when touched
    return {
      opacity: interpolate(activeInteraction.value, [0, 1], [0.85, 0.96], Extrapolation.CLAMP)
    };
  });

  const animatedEnvironmentBreathingStyle = useAnimatedStyle(() => {
    // Slow environmental luminance shifts & tiny atmospheric gradient drift
    return {
      opacity: interpolate(idleBreathing.value, [0, 1], [0, 0.04])
    };
  });

  // Bottom Sheet Entrance Animation
  useEffect(() => {
    if (isExitSheetVisible) {
      exitSheetOpacity.value = withTiming(1, { duration: 300 });
      exitSheetTranslateY.value = withTiming(0, {
        duration: 300,
        easing: Easing.bezier(0.22, 1, 0.36, 1) // Decelerating cubic-bezier curve
      });
    } else {
      exitSheetOpacity.value = withTiming(0, { duration: 300 });
      exitSheetTranslateY.value = withTiming(SCREEN_HEIGHT, {
        duration: 300,
        easing: Easing.bezier(0.22, 1, 0.36, 1)
      });
    }
  }, [isExitSheetVisible]);

  const exitSheetGesture = React.useMemo(() => {
    return Gesture.Pan()
      .onUpdate((e) => {
        if (e.translationY > 0) exitSheetTranslateY.value = e.translationY;
      })
      .onEnd((e) => {
        if (e.translationY > 100 || e.velocityY > 500) runOnJS(setIsExitSheetVisible)(false);
        else exitSheetTranslateY.value = withTiming(0, { duration: 300, easing: Easing.bezier(0.22, 1, 0.36, 1) });
      });
  }, []);

  // Proactive Image Preloading to prevent flickers during rapid swiping
  // Why frame stability feels premium: Consistent frame rates, especially during critical interactions like image loading,
  // convey a sense of reliability and high engineering quality. Any stutter or flicker breaks the illusion of a fluid, physical interface.
  // Why memory consistency affects perceived smoothness: Spikes in memory usage can trigger garbage collection, leading to micro-stutters.
  // Preloading a small, controlled set of images reduces the chance of on-demand memory allocation during a swipe.
  useEffect(() => {
    const urisToPrefetch = new Set();

    // Preload images safely while bypassing the synthetic Welcome Card
    if (visiblePhotos[currentIndex] && !visiblePhotos[currentIndex].isSynthetic) urisToPrefetch.add(visiblePhotos[currentIndex].uri);
    if (visiblePhotos[currentIndex + 1] && !visiblePhotos[currentIndex + 1].isSynthetic) urisToPrefetch.add(visiblePhotos[currentIndex + 1].uri);
    if (visiblePhotos[currentIndex + 2] && !visiblePhotos[currentIndex + 2].isSynthetic) urisToPrefetch.add(visiblePhotos[currentIndex + 2].uri);
    if (visiblePhotos[currentIndex + 3] && !visiblePhotos[currentIndex + 3].isSynthetic) urisToPrefetch.add(visiblePhotos[currentIndex + 3].uri);
    
    if (currentIndex > 0 && visiblePhotos[currentIndex - 1] && !visiblePhotos[currentIndex - 1].isSynthetic) urisToPrefetch.add(visiblePhotos[currentIndex - 1].uri);

    urisToPrefetch.forEach(uri => {
      if (uri) Image.prefetch(uri).catch(e => console.log("Prefetch error:", e)); 
    });
  }, [currentIndex, visiblePhotos]);

  // Gently fade in the completion screen when all photos are processed
  useEffect(() => {
    if (hasLoaded && allPhotos.length > 0 && currentIndex >= allPhotos.length && !hasNextPage) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 2000, // Very slow, soft fade
        useNativeDriver: true,
      }).start();
    }
  }, [currentIndex, allPhotos.length, hasNextPage, hasLoaded, fadeAnim]);

  useEffect(() => {
    setIsHistoryLoaded(true);
    handlePermission();
  }, []);

  // Persist Delete Queue to storage silently so sessions can be restored
  useEffect(() => {
    if (isHistoryLoaded) {
      const albumId = selectedAlbum ? selectedAlbum.id : 'all';
      AsyncStorage.setItem(`@delete_queue_${albumId}`, JSON.stringify(deleteQueue)).catch(() => {});
    }
  }, [deleteQueue, isHistoryLoaded, selectedAlbum]);

  // Intercept Android Back Button
  useEffect(() => {
    const backAction = () => {
      if (isAlbumSwitcherVisible) {
        setIsAlbumSwitcherVisible(false);
        return true;
      }
      if (inspectingPhoto) {
        setInspectingPhoto(null);
        return true;
      }
      if (isReviewing) {
        setIsReviewing(false);
        return true; 
      }
      if (isExitSheetVisible) {
        setIsExitSheetVisible(false);
        return true;
      }
      if (isConfiguring) {
        setIsConfiguring(false);
        return true;
      }
      
      if (deleteQueue.length > 0) {
        setIsExitSheetVisible(true);
        return true; 
      } else {
        Alert.alert("Exit Application?", "You haven't marked any photos for deletion in this session.", [
          { text: "Keep Reviewing", style: "cancel" },
          { text: "Exit", style: "destructive", onPress: () => BackHandler.exitApp() }
        ]);
        return true;
      }
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [isAlbumSwitcherVisible, inspectingPhoto, isReviewing, deleteQueue.length, isConfiguring, isExitSheetVisible]);

  const handlePermission = async () => {
    setPermissionStatus('checking');
    const granted = await requestGalleryPermission();
    if (granted) {
      try {
        const onboardingStatus = await AsyncStorage.getItem('@onboarding_complete');
        hasSeenOnboardingRef.current = onboardingStatus === 'true';
      } catch (e) {}

      setPermissionStatus('granted');
      fetchAlbums();
      handleSelectAlbum(null);
    } else {
      setPermissionStatus('denied');
    }
  };

  const fetchAlbums = async () => {
    try {
      const fetchedAlbums = await MediaLibrary.getAlbumsAsync({
        includeSmartAlbums: true,
      });
      fetchedAlbums.sort((a, b) => b.assetCount - a.assetCount);
      const validAlbums = fetchedAlbums.filter(a => a.assetCount > 0);
      setAlbums(validAlbums);
    } catch (e) {}
  };

  const handleSelectAlbum = async (album) => {
    setSelectedAlbum(album);
    
    try {
      const albumId = album ? album.id : 'all';
      const storedQueue = await AsyncStorage.getItem(`@delete_queue_${albumId}`);
      if (storedQueue) {
        setDeleteQueue(JSON.parse(storedQueue));
      } else {
        setDeleteQueue([]);
      }

      const storedHistory = await AsyncStorage.getItem(`@swipe_history_${albumId}`);
      if (storedHistory) {
        const parsed = JSON.parse(storedHistory);
        swipeHistoryRef.current = parsed;
        swipedPhotoIdsRef.current = new Set(parsed.map(item => item.id));
        
        let kept = 0;
        let removed = 0;
        parsed.forEach(item => {
          if (item.type === 'keep') kept++;
          if (item.type === 'remove') removed++;
        });
        setKeptCount(kept);
        setRemovedCount(removed);
      } else {
        swipeHistoryRef.current = [];
        swipedPhotoIdsRef.current = new Set();
        setKeptCount(0);
        setRemovedCount(0);
      }
    } catch (e) {}

    setIsConfiguring(false); 
    setUndoStack([]);
    resetAndLoad();
  };

  const handleBackToAlbums = () => {
    if (deleteQueue.length > 0) {
      setIsReviewing(true);
    } else {
      setIsAlbumSwitcherVisible(true);
    }
  };

  const fetchPhotos = useCallback(async (loadMore = false) => {
    if (isFetching || (!hasNextPage && loadMore)) return;

    setIsFetching(true);
    try {
      const options = {
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        first: 100, // Initially fetch 100 photos
        sortBy: [[MediaLibrary.SortBy.creationTime, sortOrder === 'asc']], 
      };
      
      if (selectedAlbum) {
        options.album = selectedAlbum.id;
      }

      if (loadMore && endCursor) {
        options.after = endCursor;
      }

      if (startDate) {
        options.createdAfter = startDate.getTime();
      }
      if (endDate) {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999); // Push to the very end of the selected day
        options.createdBefore = endOfDay.getTime();
      }
      
      const { assets, endCursor: newCursor, hasNextPage: next } = await MediaLibrary.getAssetsAsync(options);
      
      setAllPhotos(prev => {
        // Memory Optimization: Strip heavy EXIF metadata out of the array for the 10k+ images.
        const filteredAssets = assets
          .filter(p => !swipedPhotoIdsRef.current.has(p.id))
          .map(p => ({ 
            id: p.id, 
            uri: p.uri,
            width: p.width, // Needed for dynamic layout rendering
            height: p.height 
          }));

        if (!loadMore) {
          if (!hasSeenOnboardingRef.current && !selectedAlbum) {
            const SYNTHETIC_WELCOME_CARD = {
              id: 'onboarding-welcome',
              isSynthetic: true,
              width: 3,
              height: 4,
              uri: null
            };
            return [SYNTHETIC_WELCOME_CARD, ...filteredAssets];
          }
          return filteredAssets;
        }
        
        const existingIds = new Set(prev.map(p => p.id));
        const newAssets = filteredAssets.filter(p => !existingIds.has(p.id));
        return [...prev, ...newAssets];
      });

      setEndCursor(newCursor);
      setHasNextPage(next);
    } catch (error) {
      // Fail silently to maintain a calm environment
    } finally {
      setIsFetching(false);
      if (!loadMore) setHasLoaded(true);
    }
  }, [isFetching, hasNextPage, endCursor, startDate, endDate]);

  const loadPhotos = () => fetchPhotos(false);

  useEffect(() => {
    // Maintain visiblePhotos buffer (top N cards) to ensure smooth swiping without memory overload
    const bufferSize = 20;
    const targetVisibleLength = currentIndex + bufferSize;
    
    if (visiblePhotos.length < targetVisibleLength && allPhotos.length > visiblePhotos.length) {
      const nextBatch = allPhotos.slice(visiblePhotos.length, targetVisibleLength);
      if (nextBatch.length > 0) {
        setVisiblePhotos(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const newAssets = nextBatch.filter(p => !existingIds.has(p.id));
          return [...prev, ...newAssets];
        });
      }
    }

    // When remaining unseen cards become less than 20, fetch more photos automatically
    const unseenInAll = allPhotos.length - currentIndex;
    if (unseenInAll < 20 && hasNextPage && !isFetching && hasLoaded) {
      fetchPhotos(true);
    }
  }, [currentIndex, allPhotos, visiblePhotos.length, hasNextPage, isFetching, hasLoaded, fetchPhotos]);

  const saveSwipe = useCallback((photo, type) => {
    if (!photo || !selectedAlbum) return;
    const record = {
      id: photo.id,
      type,
      timestamp: Date.now()
    };
    swipeHistoryRef.current.push(record);
    swipedPhotoIdsRef.current.add(photo.id);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    // Debounce AsyncStorage writes to prevent UI thread lockups during rapid swiping
    saveTimeoutRef.current = setTimeout(() => {
      const albumId = selectedAlbum ? selectedAlbum.id : 'all';
      AsyncStorage.setItem(`@swipe_history_${albumId}`, JSON.stringify(swipeHistoryRef.current)).catch(() => {});
    }, 500);
  }, [selectedAlbum]);

  const pushUndo = useCallback((index, photo, type, direction) => {
    const action = { index, photo, type, id: photo.id, direction };
    setUndoStack(prev => {
      const next = [...prev, action];
      return next.slice(-10); // Maintain a lightweight memory history for undo
    });
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;

    const lastAction = undoStack[undoStack.length - 1];

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    setUndoOrigin(lastAction.direction);
    setUndoTargetId(lastAction.id);

    // 2. Undo state and pointers
    setUndoStack(prev => prev.slice(0, -1));
    setCurrentIndex(prev => prev - 1);

    // 3. Remove from respective queues
    if (lastAction.type === 'remove') {
      setDeleteQueue(prev => prev.filter(p => p.id !== lastAction.id));
      setRemovedCount(prev => prev - 1);
    } else {
      setKeptQueue(prev => prev.filter(p => p.id !== lastAction.id));
      setKeptCount(prev => prev - 1);
    }

    // 4. Scrub persistent storage markers
    swipeHistoryRef.current = swipeHistoryRef.current.filter(h => h.id !== lastAction.id);
    swipedPhotoIdsRef.current.delete(lastAction.id);

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const albumId = selectedAlbum ? selectedAlbum.id : 'all';
      AsyncStorage.setItem(`@swipe_history_${albumId}`, JSON.stringify(swipeHistoryRef.current)).catch(() => {});
    }, 500);
  }, [undoStack, selectedAlbum]);

  const handleDelete = useCallback((index) => {
    // Haptics removed: now perfectly synced to the exact release frame natively in SwipeableCard.js
    setRemovedCount(prev => prev + 1);
    const photo = visiblePhotos[index];
    if (photo) {
      saveSwipe(photo, 'remove');
      setDeleteQueue(prev => [...prev, photo]);
      pushUndo(index, photo, 'remove', 'left');
    }
  }, [visiblePhotos, saveSwipe, pushUndo]);

  const handleKeep = useCallback((index) => {
    // Haptics removed: now perfectly synced to the exact release frame natively in SwipeableCard.js
    setKeptCount(prev => prev + 1);
    const photo = visiblePhotos[index];
    if (photo) {
      saveSwipe(photo, 'keep');
      setKeptQueue(prev => [...prev, photo]);
      pushUndo(index, photo, 'keep', 'right');
    }
  }, [visiblePhotos, saveSwipe, pushUndo]);

  const handleSwiped = useCallback(() => {
    // 1. INTERACTION RHYTHM ENGINEERING
    // How dopamine loops emerge from rhythm: Snapping the active translation to 0 instantly causes 
    // the environmental atmosphere to flash away abruptly, breaking immersion. By letting it decay rapidly 
    // but smoothly, we maintain the emotional rhythm. If the user grabs the next card before this finishes, 
    // Reanimated gracefully interrupts this decay, creating a seamless flow state.
    activeTranslateX.value = withTiming(0, { duration: 250 });
    activeTranslateY.value = withTiming(0, { duration: 250 });
    
    // Safely increment the state index to avoid mutating array state aggressively while the physics engine is still calculating
    setCurrentIndex(prev => prev + 1);
  }, [activeTranslateX, activeTranslateY]);

  const toggleSelection = (id) => {
    Haptics.selectionAsync();
    setDeselectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirmDeletion = async () => {
    const itemsToDelete = deleteQueue.filter(item => !deselectedIds.has(item.id));
    const itemsToRestore = deleteQueue.filter(item => deselectedIds.has(item.id));

    if (itemsToDelete.length > 0) {
      try {
        await MediaLibrary.deleteAssetsAsync(itemsToDelete);
      } catch (error) {
        // The user cancelled the native OS deletion dialog. Abort cleanup cleanly.
        return;
      }
    }

    if (itemsToRestore.length > 0) {
      // Update historical markers so restored items become permanently "kept"
      itemsToRestore.forEach(item => {
        const idx = swipeHistoryRef.current.findIndex(h => h.id === item.id);
        if (idx !== -1) swipeHistoryRef.current[idx].type = 'keep';
      });
      const albumId = selectedAlbum ? selectedAlbum.id : 'all';
      AsyncStorage.setItem(`@swipe_history_${albumId}`, JSON.stringify(swipeHistoryRef.current)).catch(() => {});
      
      setRemovedCount(prev => prev - itemsToRestore.length);
      setKeptCount(prev => prev + itemsToRestore.length);
    }

    setDeleteQueue([]);
    setDeselectedIds(new Set());
    setIsReviewing(false);
  };

  const renderReviewScreen = () => {
    const selectedCount = deleteQueue.length - deselectedIds.size;
    const estimatedMB = (selectedCount * 3.2).toFixed(1);

    return (
      <View style={styles.fullScreenContainer}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.reviewHeader}>
            <Text style={styles.title}>review.</Text>
            <Text style={styles.subtitle}>{selectedCount} items  ·  ~{estimatedMB} MB</Text>
          </View>
          
          <FlatList
            data={deleteQueue}
            keyExtractor={item => item.id}
            numColumns={3}
            contentContainerStyle={styles.reviewGrid}
            renderItem={({ item }) => {
              const isDeselected = deselectedIds.has(item.id);
              return (
                <TouchableOpacity 
                  style={[styles.reviewItem, isDeselected && styles.reviewItemDeselected]} 
                  onPress={() => toggleSelection(item.id)}
                  activeOpacity={0.8}
                >
                  <Image 
                    source={{ uri: item.uri }} 
                    style={styles.reviewImage} 
                    resizeMode="cover" 
                    resizeMethod="resize" 
                  />
                  {!isDeselected && <View style={styles.selectedOverlay} />}
                </TouchableOpacity>
              );
            }}
          />

          <View style={styles.reviewFooter}>
            <GhostButton 
              title={selectedCount > 0 ? "confirm deletion" : "nothing to delete"} 
              onPress={selectedCount > 0 ? confirmDeletion : () => setIsReviewing(false)} 
            />
            <TouchableOpacity style={styles.cancelButton} onPress={() => setIsReviewing(false)}>
              <Text style={styles.cancelText}>go back</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  };

  const renderAlbumSwitcher = () => (
    <View style={[StyleSheet.absoluteFill, { zIndex: 2000, backgroundColor: 'rgba(13,15,18,0.95)' }]}>
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.topBarHeader, { paddingBottom: 16 }]}>
           <TouchableOpacity onPress={() => setIsAlbumSwitcherVisible(false)} hitSlop={{top: 15, bottom: 15, left: 15, right: 15}}>
             <Feather name="x" size={24} color="#f3f4f6" />
           </TouchableOpacity>
           <Text style={[styles.title, { marginBottom: 0 }]}>Albums</Text>
           <View style={{width: 24}}/>
        </View>
        <FlatList
          data={[{ id: 'all', title: 'Recents', assetCount: '-' }, ...albums]}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 32, paddingBottom: 24 }}
          renderItem={({ item }) => (
            <TouchableOpacity 
              style={{ paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.05)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
              onPress={() => {
                setIsAlbumSwitcherVisible(false);
                handleSelectAlbum(item.id === 'all' ? null : item);
              }}
            >
              <Text style={{ color: '#f3f4f6', fontSize: 16, fontWeight: '500', letterSpacing: 1 }}>{item.title}</Text>
              {item.assetCount !== '-' && <Text style={{ color: '#6b7280', fontSize: 12, fontWeight: '500', letterSpacing: 1 }}>{item.assetCount}</Text>}
            </TouchableOpacity>
          )}
        />
      </SafeAreaView>
    </View>
  );

  const renderConfigScreen = () => (
    <SafeAreaView style={styles.safeArea}>
      <View style={[styles.container, { alignItems: 'stretch', paddingHorizontal: 24, paddingTop: 40 }]}>
        <View style={styles.configHeader}>
          <Text style={styles.configTitle}>Filter & Sort</Text>
          <Text style={styles.configSubtitle}>
            {selectedAlbum ? `${selectedAlbum.title} (${selectedAlbum.assetCount} items)` : 'Recents (All Photos)'}
          </Text>
        </View>

        <View style={styles.configSection}>
          <Text style={styles.configSectionTitle}>Date Range</Text>
          <View style={styles.appleListContainer}>
            <TouchableOpacity style={[styles.appleListItem, styles.appleListBorder]} onPress={() => setShowDatePicker('start')} activeOpacity={0.7}>
              <Text style={styles.appleListLabel}>Start Date</Text>
              <Text style={styles.appleListValue}>{startDate ? startDate.toLocaleDateString() : 'Any'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.appleListItem} onPress={() => setShowDatePicker('end')} activeOpacity={0.7}>
              <Text style={styles.appleListLabel}>End Date</Text>
              <Text style={styles.appleListValue}>{endDate ? endDate.toLocaleDateString() : 'Any'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.configSection}>
          <Text style={styles.configSectionTitle}>Order</Text>
          <View style={styles.appleListContainer}>
            <TouchableOpacity style={styles.appleListItem} onPress={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')} activeOpacity={0.7}>
              <Text style={styles.appleListLabel}>Sort Direction</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.appleListValue}>{sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}</Text>
                <Feather name="refresh-cw" size={16} color="#A1A1A1" />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ flex: 1 }} />

        <TouchableOpacity style={styles.applePrimaryButton} onPress={() => { setIsConfiguring(false); resetAndLoad(); }} activeOpacity={0.8}>
          <Text style={styles.applePrimaryButtonText}>Apply Filters</Text>
        </TouchableOpacity>
        
        <TouchableOpacity onPress={() => setIsConfiguring(false)} activeOpacity={0.6}>
          <Text style={styles.appleCancelButtonText}>Cancel</Text>
        </TouchableOpacity>

        {showDatePicker && (
          <DateTimePicker
            value={showDatePicker === 'start' ? (startDate || new Date()) : (endDate || new Date())}
            mode="date"
            display="default"
            themeVariant="dark"
            onChange={(event, selectedDate) => {
              const currentMode = showDatePicker;
              setShowDatePicker(null);
              if (event.type === 'set' && selectedDate) {
                if (currentMode === 'start') setStartDate(selectedDate);
                if (currentMode === 'end') setEndDate(selectedDate);
              }
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );

  const renderEmptyState = () => (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Reanimated.View style={[styles.completionRing, animatedDeckBreathingStyle]}>
           <Feather name="moon" size={30} color="#6b7280" style={{opacity: 0.4}} />
        </Reanimated.View>
        <Text style={styles.completionTitle}>it's quiet here.</Text>
        <Text style={styles.completionSubtitle}>no memories found in this range.</Text>
        <View style={[styles.spacer, { height: 40 }]} />
        <GhostButton title="go back" onPress={() => {
          setIsConfiguring(true);
        }} />
      </View>
    </SafeAreaView>
  );

  const renderCompletionState = () => (
    <SafeAreaView style={styles.safeArea}>
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        
        {/* Why subtle completion feedback increases satisfaction: Tiny ambient motion (like this breathing ring) 
            silently acknowledges the accomplishment without demanding attention. It feels like the app is gently exhaling. */}
        <Reanimated.View style={[styles.completionRing, animatedDeckBreathingStyle]}>
           <Feather name="wind" size={32} color="#888888" style={{opacity: 0.5}} />
        </Reanimated.View>
        
        {/* Why calm reward loops feel premium: Gamified "achievement" screens create cortisol-driven loops. 
            A quiet, soft completion screen focuses on relief, mapping perfectly to the emotional release of decluttering. */}
        <Text style={styles.completionTitle}>the gallery feels lighter.</Text>
        
        {/* Why emotional relief improves retention: Users return to apps that make them feel safe and peaceful. 
            Ending on a visually spacious note leaves a lingering sense of satisfaction rather than overstimulation. */}
        <Text style={styles.completionSubtitle}>this space is clean and curated.</Text>
        <View style={styles.spacer} />
        <Text style={styles.completionStats}>kept {keptCount}   ·   cleared {removedCount}</Text>
        
        {deleteQueue.length > 0 && (
          <>
            <View style={styles.spacer} />
            <GhostButton title="review deletions" onPress={() => setIsReviewing(true)} />
          </>
        )}
        
        <View style={[styles.spacer, { height: 48 }]} />
        <TouchableOpacity onPress={() => {
          setSortOrder('asc');
          resetAndLoad();
        }} hitSlop={{top: 15, bottom: 15, left: 15, right: 15}}>
          <Text style={styles.cancelText}>review older photos</Text>
        </TouchableOpacity>
        
        <View style={styles.spacer} />
        <TouchableOpacity onPress={handleBackToAlbums} hitSlop={{top: 15, bottom: 15, left: 15, right: 15}}>
          <Text style={styles.cancelText}>← switch albums</Text>
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );

  const renderExitSheet = () => {
    return (
      <View style={[StyleSheet.absoluteFill, { zIndex: 3000 }]} pointerEvents={isExitSheetVisible ? "auto" : "none"}>
        <Reanimated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }, { opacity: exitSheetOpacity }]} pointerEvents={isExitSheetVisible ? "auto" : "none"}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setIsExitSheetVisible(false)} />
        </Reanimated.View>
        
        <GestureDetector gesture={exitSheetGesture}>
          <Reanimated.View style={[styles.exitSheetContainer, { transform: [{ translateY: exitSheetTranslateY }] }]}>
            <View style={styles.exitSheetHandle} />
            <View style={styles.exitSheetContent}>
              <Text style={styles.exitSheetTitle}>Delete permanently?</Text>
              <Text style={styles.exitSheetSubtitle}>{deleteQueue.length} items will be permanently removed from local storage.</Text>
              
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.exitSheetTrack} contentContainerStyle={{ paddingHorizontal: 24, gap: 8 }}>
                {deleteQueue.map((item, index) => (
                  <ExitThumbnail key={item.id} item={item} index={index} />
                ))}
              </ScrollView>

              <View style={styles.exitSheetActionStack}>
                <TouchableOpacity 
                  style={styles.exitSheetConfirmBtn} 
                  activeOpacity={0.8}
                  onPress={async () => {
                    try {
                      await MediaLibrary.deleteAssetsAsync(deleteQueue);
                      setDeleteQueue([]);
                      BackHandler.exitApp();
                    } catch (e) {
                      setIsExitSheetVisible(false);
                    }
                  }}
                >
                  <Text style={styles.exitSheetConfirmText}>Permanently Delete {deleteQueue.length} Photos</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.exitSheetDeselectBtn} 
                  activeOpacity={0.7}
                  onPress={() => {
                    const itemsToRestore = [...deleteQueue];
                    itemsToRestore.forEach(item => {
                      const idx = swipeHistoryRef.current.findIndex(h => h.id === item.id);
                      if (idx !== -1) swipeHistoryRef.current[idx].type = 'keep';
                    });
                    const albumId = selectedAlbum ? selectedAlbum.id : 'all';
                    AsyncStorage.setItem(`@swipe_history_${albumId}`, JSON.stringify(swipeHistoryRef.current)).catch(() => {});
                    
                    setRemovedCount(prev => prev - itemsToRestore.length);
                    setKeptCount(prev => prev + itemsToRestore.length);
                    setDeleteQueue([]);
                    setIsExitSheetVisible(false);
                  }}
                >
                  <Text style={styles.exitSheetDeselectText}>Deselect All & Keep Everything</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.exitSheetCancelBtn} activeOpacity={0.7} onPress={() => setIsExitSheetVisible(false)}>
                  <Text style={styles.exitSheetCancelText}>Go Back to Swiping</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Reanimated.View>
        </GestureDetector>
      </View>
    );
  };

  const atmosphereLeftStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      activeTranslateX.value,
      [-SCREEN_WIDTH * 0.25, 0],
      [0.08, 0], // Reduced max opacity for restrained, subconscious feedback
      Extrapolation.CLAMP
    ),
    // Why emotional pacing affects retention: Subtle deep crimson implies destructive finality without 
    // triggering visual alarm or gamified harshness.
    backgroundColor: '#FF3B30', 
  }));

  const atmosphereRightStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      activeTranslateX.value,
      [0, SCREEN_WIDTH * 0.25],
      [0, 0.08], 
      Extrapolation.CLAMP
    ),
    // Soft, organic green (similar to Apple's success colors) establishes positive, relieving momentum
    backgroundColor: '#34C759', 
  }));

  const atmosphereUpStyle = useAnimatedStyle(() => {
    // Suppress the gold up-swipe tint if the user is primarily swiping left/right
    const horizontalSuppression = interpolate(
      Math.abs(activeTranslateX.value),
      [0, SCREEN_WIDTH * 0.15],
      [1, 0],
      Extrapolation.CLAMP
    );
    const rawOpacity = interpolate(
      activeTranslateY.value,
      [-SCREEN_HEIGHT * 0.15, 0], 
      [0.10, 0],
      Extrapolation.CLAMP
    );
    return {
      opacity: rawOpacity * horizontalSuppression,
      backgroundColor: '#FFD700', // Elegant gold tint
    };
  });

  const bottomBarGesture = React.useMemo(() => {
    return Gesture.Pan()
      .activeOffsetY([-10, 10])
      .onEnd((e) => {
        if (e.translationY < -30 || e.velocityY < -500) {
          runOnJS(handleUndo)();
        }
      });
  }, [handleUndo]);

  const renderSwipeScreen = () => {
    const cardsToRender = visiblePhotos
      .map((photo, index) => ({ photo, index }))
      .slice(currentIndex, currentIndex + 3)
      .reverse();

    return (
      <View style={styles.fullScreenContainer}>
        <SafeAreaView style={styles.topBarSafeArea} pointerEvents="box-none">
          <View style={styles.topBarHeader}>
            <TouchableOpacity onPress={handleBackToAlbums} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[styles.title, { marginBottom: 0, marginRight: 8 }]}>
                {selectedAlbum ? selectedAlbum.title : 'Recents'}
              </Text>
              <Feather name="chevron-down" size={20} color="#EAEAEA" />
            </TouchableOpacity>
            
            <TouchableOpacity onPress={() => setIsConfiguring(true)} style={styles.appleFilterButton} activeOpacity={0.7}>
              <Text style={styles.appleFilterButtonText}>Filter</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {visiblePhotos[currentIndex] && (
            <Image
              source={{ uri: visiblePhotos[currentIndex].uri }}
              style={StyleSheet.absoluteFill}
              blurRadius={60}
            />
          )}
        <Reanimated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#0d0f12' }, atmosphericBackgroundStyle]} />
        
        {/* Subconscious Emotional Atmosphere Feedback */}
        {/* Why subtlety increases perceived sophistication: Gamified colors distract from photos. A max 12-14% opacity softly shifts the emotional tone without looking like "UI". */}
        {/* Why subconscious feedback works better: Instinctive environmental color changes (red for finality, warm light for keeping) map directly to human psychology, speeding up decisions confidently. */}
        {/* How emotional atmosphere reinforces decision-making: Linking the dynamic fade exactly to the physical drag connects the finger to the screen's atmosphere, making it feel deeply tactile. */}
        <Reanimated.View style={[StyleSheet.absoluteFill, atmosphereLeftStyle]} />
        <Reanimated.View style={[StyleSheet.absoluteFill, atmosphereRightStyle]} />
        <Reanimated.View style={[StyleSheet.absoluteFill, atmosphereUpStyle]} />
        
        {/* Subtle Ambient Breathing Luminance */}
        <Reanimated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF' }, animatedEnvironmentBreathingStyle]} />
        </View>

        <Reanimated.View style={[styles.deckContainer, animatedDeckBreathingStyle]}>
          {cardsToRender.map((item, stackIndexReversed) => {
            const { photo, index } = item;
            const indexInStack = cardsToRender.length - 1 - stackIndexReversed;
            const isTopCard = indexInStack === 0;

            return (
              <SwipeableCard
                key={photo.id}
                isTopCard={isTopCard}
                indexInStack={indexInStack}
                activeTranslateX={activeTranslateX}
                activeTranslateY={activeTranslateY}
                activeInteraction={activeInteraction}
                animateFromDirection={isTopCard && undoTargetId === photo.id ? undoOrigin : null}
                onPress={() => !photo.isSynthetic && setInspectingPhoto(photo)}
                onSwipeLeft={() => {
                  handleDelete(index);
                  handleSwiped();
                }}
                onSwipeRight={() => {
                  handleKeep(index);
                  handleSwiped();
                }}
              >
                {photo.isSynthetic ? (
                  <WelcomeCard activeTranslateX={activeTranslateX} />
                ) : (
                  <PhotoCard card={photo} isInspecting={inspectingPhoto?.id === photo.id} />
                )}
              </SwipeableCard>
            );
          })}
        </Reanimated.View>

        <SafeAreaView style={styles.bottomBarSafeArea} pointerEvents="box-none">
          {/* Why secondary UI should visually submit: The photo is the hero. By stripping away loud 
              colors and aggressive containers from the controls, we preserve the immersive, emotional 
              weight of the images. Controls serve as gentle suggestions, not demands. */}
          {/* How ergonomic positioning improves emotional comfort: Placing critical but secondary 
              actions exactly where the thumbs naturally rest at the bottom corners removes physical 
              reach and cognitive friction, keeping the user in a flow state. */}
          <GestureDetector gesture={bottomBarGesture}>
            <Reanimated.View style={[styles.bottomControls, animatedSecondaryStyle]} pointerEvents="auto">
              <View style={[styles.controlSide, { alignItems: 'flex-start' }]}>
                <TactileButton 
                  icon="grid" 
                  onPress={handleBackToAlbums} 
                />
              </View>
              
              <View style={styles.progressContainer} pointerEvents="none">
                <Text style={styles.counterText}>
                  {currentIndex + 1} <Text style={styles.counterMuted}>of {allPhotos.length}{isFetching ? '...' : ''}</Text>
                </Text>
                <View style={styles.statDots}>
                  <Text style={styles.statText}>kept {keptCount}   ·   rmvd {removedCount}</Text>
                </View>
              </View>
              
              <View style={[styles.controlSide, { alignItems: 'flex-end' }]}>
                <TactileButton 
                  icon="rotate-ccw" 
                  onPress={handleUndo} 
                  disabled={undoStack.length === 0}
                />
              </View>
            </Reanimated.View>
          </GestureDetector>
        </SafeAreaView>
        
        {inspectingPhoto && (
          <FullscreenViewer 
            photo={inspectingPhoto} 
            onClose={() => setInspectingPhoto(null)} 
          />
        )}
      </View>
    );
  };

  if (!isHistoryLoaded || permissionStatus === 'checking') {
    return <View style={styles.cinematicBackground} />;
  }

  if (permissionStatus === 'denied') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Reanimated.View style={[styles.container, animatedContentStyle]}>
          <View style={styles.textContainer}>
            <Text style={styles.title}>BlinkClean</Text>
            <Reanimated.View style={animatedSecondaryStyle}>
              <Text style={styles.subtitle}>clean memories quietly</Text>
            </Reanimated.View>
          </View>
          <Reanimated.View style={[styles.actionContainer, animatedSecondaryStyle]}>
            <Text style={styles.statusText}>Gallery access needed</Text>
            <View style={styles.spacer} />
            <GhostButton title="retry" onPress={handlePermission} />
          </Reanimated.View>
        </Reanimated.View>
      </SafeAreaView>
    );
  }

  if (permissionStatus === 'granted') {
    return (
      <>
        {isConfiguring ? renderConfigScreen() :
         isReviewing ? renderReviewScreen() :
         (hasLoaded && allPhotos.length === 0 && !hasNextPage) ? renderEmptyState() :
         (currentIndex >= allPhotos.length && !hasNextPage && !isFetching) ? renderCompletionState() :
         (allPhotos.length > 0) ? renderSwipeScreen() :
         (
           <SafeAreaView style={styles.safeArea}>
             <Reanimated.View style={[styles.container, animatedContentStyle]}>
               <Reanimated.View style={animatedSecondaryStyle}>
                 <Text style={styles.statusText}>gathering memories...</Text>
               </Reanimated.View>
             </Reanimated.View>
           </SafeAreaView>
         )
        }
        {isAlbumSwitcherVisible && renderAlbumSwitcher()}
        {renderExitSheet()}
      </>
    );
  }
}

const styles = StyleSheet.create({
  cinematicBackground: {
    flex: 1,
    backgroundColor: '#0d0f12', // Rich, deep obsidian blue-gray
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#0d0f12',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  textContainer: {
    alignItems: 'center',
    marginBottom: 80, 
  },
  actionContainer: {
    alignItems: 'center',
  },
  spacer: {
    height: 24,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
    letterSpacing: 2,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    textAlign: 'center',
    minWidth: 110,
  },
  dateSeparator: {
    fontSize: 12,
    color: '#6b7280',
    marginHorizontal: 12,
  },
  sortText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
    letterSpacing: 1.5,
    paddingVertical: 8,
  },
  fullScreenContainer: {
    flex: 1,
    backgroundColor: '#0d0f12',
  },
  topBarSafeArea: {
    position: 'absolute',
    top: 0,
    width: '100%',
    zIndex: 10,
  },
  bottomBarSafeArea: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    zIndex: 10,
  },
  topBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  backButton: {
    paddingVertical: 8,
    paddingRight: 16,
  },
  backButtonText: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 1.5,
  },
  statsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  statText: {
    fontSize: 10,
    fontWeight: '500',
    color: '#6b7280',
    letterSpacing: 2,
  },
  cardSkeleton: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1a1d24',
  },
  deckContainer: {
    flex: 1,
    marginTop: 72, // Reduced space to maximize portrait aspect ratio
    marginBottom: 86, // Reduced space to maximize portrait aspect ratio
    marginHorizontal: 8, // Pushed closer to screen edges
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24, // Softer Apple-like rounding
    overflow: 'hidden',
    // How luminance separation improves tactile perception: Instead of absolute black, 
    // we use layered graphite (#121214 on #08080A). This slight luminance difference 
    // creates natural depth without relying purely on shadows, making the card feel tactile.
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)', // Match blueprint CARD_BORDER token
  },
  welcomeCard: {
    flex: 1,
    backgroundColor: '#1D2029', // Matte Ceramic
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
  },
  welcomeCentralArtUnit: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    paddingBottom: '20%', // Geometrically weighted to Top-Half
  },
  welcomeTitle: {
    fontWeight: '700',
    fontSize: 24,
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginTop: 16,
  },
  welcomeSubtitle: {
    fontWeight: '400',
    fontSize: 14,
    color: '#A1A1A1',
    marginTop: 4,
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  fullscreenImage: {
    width: '100%',
    height: '100%',
  },
  overlaySafeArea: {
    flex: 1,
    justifyContent: 'flex-end',
    position: 'absolute',
    bottom: 0,
    width: '100%',
    zIndex: 10,
  },
  counterContainer: {
    alignItems: 'center',
    paddingBottom: 32,
  },
  counterText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
    fontVariant: ['tabular-nums'],
    letterSpacing: 3,
  },
  title: {
    fontSize: 20,
    fontWeight: '600', 
    color: '#f3f4f6',
    letterSpacing: 3,
    marginBottom: 16,
  },
  configHeader: {
    marginBottom: 32,
  },
  configTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  configSubtitle: {
    fontSize: 16,
    color: '#A1A1A1',
    fontWeight: '400',
  },
  configSection: {
    marginBottom: 28,
  },
  configSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 12,
    marginLeft: 4,
  },
  appleListContainer: {
    backgroundColor: '#1C1F26',
    borderRadius: 16,
    overflow: 'hidden',
  },
  appleListItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  appleListBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  appleListLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#F3F4F6',
  },
  appleListValue: {
    fontSize: 16,
    color: '#A1A1A1',
  },
  appleFilterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  appleFilterButtonText: {
    color: '#f3f4f6',
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  applePrimaryButton: {
    backgroundColor: '#F3F4F6',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  applePrimaryButtonText: {
    color: '#0D0F12',
    fontSize: 17,
    fontWeight: '600',
  },
  appleCancelButtonText: {
    color: '#6B7280',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 24,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6b7280',
    letterSpacing: 2,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
    letterSpacing: 2,
  },
  reviewHeader: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 32,
  },
  reviewGrid: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  reviewItem: {
    flex: 1,
    aspectRatio: 1,
    margin: 4,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1a1d24',
  },
  reviewItemDeselected: {
    opacity: 0.25,
  },
  reviewImage: {
    width: '100%',
    height: '100%',
  },
  selectedOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: 12,
  },
  reviewFooter: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  cancelButton: {
    marginTop: 20,
    padding: 12,
  },
  cancelText: {
    color: '#6b7280',
    fontSize: 12,
    letterSpacing: 2,
  },
  completionRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
    backgroundColor: '#1a1d24',
  },
  completionTitle: {
    fontSize: 20,
    fontWeight: '600', 
    color: '#f3f4f6',
    letterSpacing: 2,
    marginBottom: 12,
    textAlign: 'center',
  },
  completionSubtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6b7280',
    letterSpacing: 1.5,
    textAlign: 'center',
    marginBottom: 8,
  },
  completionStats: {
    fontSize: 11,
    fontWeight: '500',
    color: '#6b7280',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  bottomControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 24, // Bottom-weighted ergonomics
    paddingTop: 24, // Expanding hit area for bezel-swipe up gesture
  },
  controlSide: {
    flex: 1,
    justifyContent: 'center',
  },
  tactileButton: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.02)', // Extremely subtle dark grounding
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  tactileButtonText: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 2,
  },
  progressContainer: {
    flex: 2,
    alignItems: 'center',
  },
  counterMuted: {
    color: '#6b7280',
  },
  statDots: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  exitSheetContainer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    backgroundColor: '#0D0F12',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 32,
  },
  exitSheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
  },
  exitSheetContent: {
    paddingTop: 24,
  },
  exitSheetTitle: {
    fontWeight: '700',
    fontSize: 22,
    color: '#F3F4F6',
    paddingHorizontal: 24,
  },
  exitSheetSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 8,
    paddingHorizontal: 24,
  },
  exitSheetTrack: {
    marginTop: 20,
    height: 70,
    flexGrow: 0,
  },
  exitThumbnail: {
    width: 50,
    height: 66,
    borderRadius: 8,
    overflow: 'hidden',
  },
  exitSheetActionStack: {
    marginTop: 28,
    paddingHorizontal: 24,
  },
  exitSheetConfirmBtn: {
    width: '100%',
    height: 54,
    backgroundColor: '#EF4444',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  exitSheetConfirmText: {
    fontWeight: '600',
    color: '#FFFFFF',
    fontSize: 16,
  },
  exitSheetDeselectBtn: {
    width: '100%',
    height: 50,
    backgroundColor: 'transparent',
    marginTop: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  exitSheetDeselectText: {
    fontWeight: '500',
    color: '#F3F4F6',
    fontSize: 15,
  },
  exitSheetCancelBtn: {
    width: '100%',
    height: 50,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  exitSheetCancelText: {
    fontWeight: '400',
    color: '#6B7280',
    fontSize: 15,
  },
});
