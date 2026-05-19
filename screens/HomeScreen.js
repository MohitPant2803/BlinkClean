import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  SafeAreaView,
  Image,
  Animated,
  TouchableOpacity
} from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Swiper from 'react-native-deck-swiper';
import DateTimePicker from '@react-native-community/datetimepicker';
import GhostButton from '../components/GhostButton';
import { requestGalleryPermission } from '../utils/permissions';

const PhotoCard = memo(({ card }) => {
  if (!card) return null;
  return (
    <View style={styles.card}>
      <Image 
        source={{ uri: card.uri }} 
        style={styles.cardImage}
        resizeMode="contain"
        resizeMethod="resize" // Drastically reduces Android memory footprint
        fadeDuration={200}    // Quicker fade feels more responsive
      />
    </View>
  );
});

export default function HomeScreen() {
  const [permissionStatus, setPermissionStatus] = useState('checking');
  
  // Persistent swipe memory
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const swipedPhotoIdsRef = useRef(new Set());
  const swipeHistoryRef = useRef([]);
  const saveTimeoutRef = useRef(null);

  // Clean, separated state as requested
  const [allPhotos, setAllPhotos] = useState([]);
  const [visiblePhotos, setVisiblePhotos] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [endCursor, setEndCursor] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(true);
  const [isFetching, setIsFetching] = useState(false);

  const [keptCount, setKeptCount] = useState(0);
  const [removedCount, setRemovedCount] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const [isConfiguring, setIsConfiguring] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(null); // 'start' | 'end' | null

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
    const loadHistory = async () => {
      try {
        const storedHistory = await AsyncStorage.getItem('@swipe_history');
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
        }
      } catch (e) {
        // Fail silently to maintain the calm environment
      } finally {
        setIsHistoryLoaded(true);
      }
    };

    loadHistory();
    handlePermission();
  }, []);

  const handlePermission = async () => {
    setPermissionStatus('checking');
    const granted = await requestGalleryPermission();
    if (granted) {
      setPermissionStatus('granted');
      setIsConfiguring(true);
    } else {
      setPermissionStatus('denied');
    }
  };

  const fetchPhotos = useCallback(async (loadMore = false) => {
    if (isFetching || (!hasNextPage && loadMore)) return;

    if (!loadMore) {
      setIsConfiguring(false);
      setHasLoaded(false);
      setAllPhotos([]);
      setVisiblePhotos([]);
      setCurrentIndex(0);
      setEndCursor(null);
      setHasNextPage(true);
    }

    setIsFetching(true);
    try {
      const options = {
        mediaType: MediaLibrary.MediaType.photo,
        first: 100, // Initially fetch 100 photos
        sortBy: [MediaLibrary.SortBy.creationTime], 
      };
      
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
        const filteredAssets = assets.filter(p => !swipedPhotoIdsRef.current.has(p.id));
        if (!loadMore) return filteredAssets;
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
    if (!photo) return;
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
      AsyncStorage.setItem('@swipe_history', JSON.stringify(swipeHistoryRef.current)).catch(() => {});
    }, 500);
  }, []);

  const handleDelete = useCallback((index) => {
    setRemovedCount(prev => prev + 1);
    const photo = visiblePhotos[index];
    if (photo) saveSwipe(photo, 'remove');
  }, [visiblePhotos, saveSwipe]);

  const handleKeep = useCallback((index) => {
    setKeptCount(prev => prev + 1);
    const photo = visiblePhotos[index];
    if (photo) saveSwipe(photo, 'keep');
  }, [visiblePhotos, saveSwipe]);

  const handleSwiped = useCallback((index) => {
    setCurrentIndex(index + 1);
  }, []);

  const renderCard = useCallback((card) => {
    return <PhotoCard card={card} />;
  }, []);

  if (!isHistoryLoaded) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Text style={styles.statusText}>waking up...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (permissionStatus === 'granted' && hasLoaded && allPhotos.length === 0 && !hasNextPage) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Text style={styles.title}>no memories found.</Text>
          <Text style={styles.subtitle}>try another date range</Text>
          <View style={styles.spacer} />
          <GhostButton title="go back" onPress={() => {
            setHasLoaded(false);
            setIsConfiguring(true);
          }} />
        </View>
      </SafeAreaView>
    );
  }

  if (permissionStatus === 'granted' && allPhotos.length > 0) {
    if (currentIndex >= allPhotos.length && !hasNextPage && !isFetching) {
      return (
        <SafeAreaView style={styles.safeArea}>
          <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
            <Text style={styles.title}>all clean.</Text>
            <Text style={styles.subtitle}>nothing more for now</Text>
            <View style={styles.spacer} />
            <Text style={styles.statText}>kept {keptCount}   ·   removed {removedCount}</Text>
          </Animated.View>
        </SafeAreaView>
      );
    }

    return (
      <View style={styles.fullScreenContainer}>
        <SafeAreaView style={styles.topBarSafeArea} pointerEvents="none">
          <View style={styles.statsContainer}>
            <Text style={styles.statText}>kept {keptCount}</Text>
            <Text style={styles.statText}>removed {removedCount}</Text>
            <Text style={styles.statText}>buffered {allPhotos.length - currentIndex}</Text>
          </View>
        </SafeAreaView>
        <Swiper
          cards={visiblePhotos}
          renderCard={renderCard}
          onSwiped={handleSwiped}
          onSwipedLeft={handleDelete}
          onSwipedRight={handleKeep}
          cardIndex={0}
          keyExtractor={(card) => card?.id || Math.random().toString()}
          backgroundColor="transparent"
          stackSize={3} // Show only top 3 cards stacked
          stackScale={2}
          stackSeparation={14}
          infinite={false}
          disableTopSwipe
          disableBottomSwipe
          animateCardOpacity
          swipeAnimationDuration={500}
          springConfig={{ tension: 20, friction: 7 }} // extremely soft spring physics
          outputRotationRange={['-5deg', '0deg', '5deg']} // barely rotates
          overlayLabels={{
            left: {
              title: 'remove',
              style: { label: styles.overlayLabel, wrapper: styles.overlayWrapperRight }
            },
            right: {
              title: 'keep',
              style: { label: styles.overlayLabel, wrapper: styles.overlayWrapperLeft }
            }
          }}
          useViewOverflow={false}
        />
        <SafeAreaView style={styles.overlaySafeArea} pointerEvents="none">
          <View style={styles.counterContainer}>
            <Text style={styles.counterText}>
              {currentIndex + 1} / {allPhotos.length}{isFetching ? ' (loading...)' : ''}
            </Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        
        <View style={styles.textContainer}>
          <Text style={styles.title}>BlinkClean</Text>
          <Text style={styles.subtitle}>clean memories quietly</Text>
        </View>

        {permissionStatus === 'checking' && (
          <Text style={styles.statusText}>breathing...</Text>
        )}

        {permissionStatus === 'denied' && (
          <View style={styles.actionContainer}>
            <Text style={styles.statusText}>Gallery access needed</Text>
            <View style={styles.spacer} />
            <GhostButton title="retry" onPress={handlePermission} />
          </View>
        )}

        {permissionStatus === 'granted' && isConfiguring && (
          <View style={styles.actionContainer}>
            <View style={styles.dateRow}>
              <TouchableOpacity onPress={() => setShowDatePicker('start')} activeOpacity={0.6}>
                <Text style={styles.dateText}>
                  {startDate ? startDate.toLocaleDateString() : 'start date'}
                </Text>
              </TouchableOpacity>
              <Text style={styles.dateSeparator}>—</Text>
              <TouchableOpacity onPress={() => setShowDatePicker('end')} activeOpacity={0.6}>
                <Text style={styles.dateText}>
                  {endDate ? endDate.toLocaleDateString() : 'end date'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.spacer} />
            <GhostButton title="begin" onPress={loadPhotos} />

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
        )}

        {permissionStatus === 'granted' && !isConfiguring && (!hasLoaded || (allPhotos.length === 0 && hasNextPage)) && (
          <Text style={styles.statusText}>gathering memories...</Text>
        )}

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
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
    fontWeight: '300',
    color: '#888888',
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
    color: '#444444',
    marginHorizontal: 12,
  },
  fullScreenContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  topBarSafeArea: {
    position: 'absolute',
    top: 0,
    width: '100%',
    zIndex: 10,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingTop: 16,
  },
  statText: {
    fontSize: 10,
    fontWeight: '300',
    color: '#555555',
    letterSpacing: 2,
  },
  card: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#030303',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)', // Soft light catch
    marginTop: 48,
    marginBottom: 80,
    shadowColor: '#000', // Deep negative space shadow
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 4,
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  overlayLabel: {
    color: '#555555',
    fontSize: 14,
    fontWeight: '300',
    letterSpacing: 3,
    backgroundColor: 'transparent',
  },
  overlayWrapperLeft: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    marginTop: 32,
    marginLeft: 32,
  },
  overlayWrapperRight: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    marginTop: 32,
    marginRight: 32,
  },
  overlaySafeArea: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  counterContainer: {
    alignItems: 'center',
    paddingBottom: 32,
  },
  counterText: {
    fontSize: 10,
    fontWeight: '300',
    color: '#444444',
    letterSpacing: 3,
  },
  title: {
    fontSize: 22,
    fontWeight: '300', 
    color: '#EAEAEA',
    letterSpacing: 3,
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '300',
    color: '#666666',
    letterSpacing: 2,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '300',
    color: '#444444',
    letterSpacing: 2,
  }
});
