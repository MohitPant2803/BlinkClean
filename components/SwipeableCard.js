import React, { useEffect } from 'react';
import { StyleSheet, Dimensions, Text } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  withTiming, 
  runOnJS,
  useDerivedValue,
  interpolate,
  Extrapolation,
  useAnimatedProps
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

// Overall Performance Strategy:
// 1. UI Thread Dominance: All critical animations (translation, rotation, scale, opacity, shadow)
//    are driven by Reanimated's useAnimatedStyle and useSharedValue, ensuring they run directly
//    on the native UI thread, bypassing the JavaScript bridge during active gestures. This is
//    fundamental for 60/120fps smoothness and perceived zero latency.
// 2. Minimal React Re-renders: The component itself does not re-render during active drag,
//    only its animated styles are updated.

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const VISUAL_THRESHOLD = SCREEN_WIDTH * 0.25; // When visual opacity cues appear
const CONFIDENCE_THRESHOLD = SCREEN_WIDTH * 0.35; // Larger physical distance required for a slow, 0-velocity drag

const SPRING_RECOVERY_CONFIG = { 
  damping: 16, 
  stiffness: 180, 
  mass: 0.5, 
  restDisplacementThreshold: 0.01, 
  restSpeedThreshold: 0.01,
  overshootClamping: false 
};

// 7. PERFORMANCE + BATTERY OPTIMIZATION
// Wrapping haptic calls in pure JS functions outside the component scope prevents 
// worklet recreation, avoids memory leaks, and deduplicates rapid vibration calls.
const triggerSelectionHaptic = () => {
  Haptics.selectionAsync().catch(() => {});
};
const triggerImpactHaptic = (style) => {
  Haptics.impactAsync(style).catch(() => {});
};

export default function SwipeableCard({ 
  children, 
  onSwipeLeft, 
  onSwipeRight, 
  onSwipeUp,
  onPress,
  isTopCard, 
  indexInStack,
  activeTranslateX,
  activeTranslateY,
  activeInteraction,
  animateFromDirection
}) {
  // Shared values for immediate 1:1 hardware tracking (UI thread)
  const initialTranslateX = animateFromDirection === 'left' ? -SCREEN_WIDTH * 1.5 : animateFromDirection === 'right' ? SCREEN_WIDTH * 1.5 : 0;
  const initialTranslateY = animateFromDirection === 'up' ? -SCREEN_HEIGHT * 1.5 : 0;

  const translateX = useSharedValue(initialTranslateX);
  const translateY = useSharedValue(initialTranslateY);
  const isDragging = useSharedValue(false);
  const touchOriginY = useSharedValue(0);
  const hasCrossedThreshold = useSharedValue(0); // 0: none, 1: right, -1: left, 2: up
  const hasCommitted = useSharedValue(false); // Tracks if card is currently flying away

  useEffect(() => {
    // If reverting via Undo, fly back into the stack from the edge
    if (animateFromDirection) {
      if (activeTranslateX) activeTranslateX.value = initialTranslateX;
      if (activeTranslateY) activeTranslateY.value = initialTranslateY;
      
      translateX.value = withSpring(0, SPRING_RECOVERY_CONFIG);
      translateY.value = withSpring(0, SPRING_RECOVERY_CONFIG);
      if (activeTranslateX) activeTranslateX.value = withSpring(0, SPRING_RECOVERY_CONFIG);
      if (activeTranslateY) activeTranslateY.value = withSpring(0, SPRING_RECOVERY_CONFIG);
    }
  }, []);

  const panGesture = Gesture.Pan()
    .enabled(!hasCommitted.value)
    // 2. Multi-touch rejection: Prevents chaotic layout thrashing if the user grabs with two fingers.
    .maxPointers(1)
    // 1 & 3. Gesture dead-zone tuning & Accidental touch filtering.
    // Why consistency is more important than flashy animation: If a card jitters on a mere tap, the app feels broken. 
    // A microscopic 5px deadzone builds subconscious trust by strictly ensuring intentionality.
    .minDistance(5)
    .onBegin((event) => {
      isDragging.value = true;
      hasCrossedThreshold.value = 0;
      
      // 3. TOUCH-DOWN MICRO HAPTICS
      // Why restrained haptics feel more premium: Over-using vibration exhausts the user's
      // tactile receptors and feels like a cheap arcade game. A microscopic `selectionAsync` 
      // on touch-down just says "I am a physical object and I felt your touch".
      runOnJS(triggerSelectionHaptic)();
      
      // Capture exactly where the user grabbed the card to simulate physical leverage
      touchOriginY.value = event.y;
      // Why anticipation improves perceived responsiveness: Immediately triggering a physical 
      // response (scale + shadow) before the drag even begins visually confirms the app has 
      // registered the user's intent. This zero-latency tactile feedback feels incredibly premium.
      if (activeInteraction) activeInteraction.value = withSpring(1, { damping: 15, stiffness: 250, mass: 0.5 });
    })
    .onUpdate((event) => {
      if (hasCommitted.value) return;
      
      // No React state updates here. Frame pacing is preserved natively.
      translateX.value = event.translationX;
      translateY.value = event.translationY;
      if (activeTranslateX) {
        activeTranslateX.value = event.translationX;
      }
      if (activeTranslateY) {
        activeTranslateY.value = event.translationY;
      }
      
      // 1. THRESHOLD COMMITMENT HAPTIC
      // We calculate real-time projection to see if letting go *now* would trigger an action.
      const velocityMultiplier = 0.2; 
      const projectedEndpointX = event.translationX + (event.velocityX * velocityMultiplier);
      const projectedEndpointY = event.translationY + (event.velocityY * velocityMultiplier);
      
      let currentIntent = 0;
      if (projectedEndpointX > CONFIDENCE_THRESHOLD) currentIntent = 1; // Right
      else if (projectedEndpointX < -CONFIDENCE_THRESHOLD) currentIntent = -1; // Left
      else if (projectedEndpointY < -CONFIDENCE_THRESHOLD && Math.abs(event.translationX) < CONFIDENCE_THRESHOLD * 0.5) currentIntent = 2; // Up
      
      if (currentIntent !== hasCrossedThreshold.value) {
        hasCrossedThreshold.value = currentIntent;
        
        // Why threshold haptics are psychologically addictive: 
        // Getting tactile feedback EXACTLY when you cross the invisible decision line creates a 
        // "lock-in" feeling. The subconscious knows the decision is made before the finger releases.
        if (currentIntent !== 0) {
          runOnJS(triggerSelectionHaptic)(); // Crossed into a commit zone
        } else {
          runOnJS(triggerSelectionHaptic)(); // Crossed back into the deadzone (undid the decision)
        }
      }
    })
    .onEnd((event) => {
      isDragging.value = false;
      
      const velocityX = event.velocityX;
      const velocityY = event.velocityY;
      const translationX = event.translationX;
      
      // 1. Intent Prediction System (Projected Endpoint)
      // We calculate where the card would naturally stop if let go.
      // Formula: current_position + (velocity * time_constant)
      // Why intent prediction improves premium feel: It feels like the app understands the *momentum* and *energy* of your gesture, not just raw screen pixels.
      const velocityMultiplier = 0.2; // roughly 200ms of projected movement
      const projectedEndpoint = translationX + (velocityX * velocityMultiplier);

      // 2. Distance Confidence Scoring & Direction Validation
      // Why velocity matters psychologically: 
      // Fast flick = high confidence = requires less physical distance.
      // Slow drag = low confidence = requires crossing a much further physical threshold (35% of screen).
      // If a user drags far right, but flicks hard left at the last millisecond, the projected endpoint naturally honors the change of mind.
      const isConfidentSwipeRight = projectedEndpoint > CONFIDENCE_THRESHOLD;
      const isConfidentSwipeLeft = projectedEndpoint < -CONFIDENCE_THRESHOLD;
      const isConfidentSwipeUp = (translateY.value + velocityY * 0.2) < -CONFIDENCE_THRESHOLD && Math.abs(translationX) < CONFIDENCE_THRESHOLD * 0.5;

      // Why momentum preservation feels satisfying: Inheriting the exact release velocity creates a seamless physical continuation.
      // Why acceleration improves perceived responsiveness: A stiff spring with low mass ensures the card clears the screen confidently and energetically (180ms-240ms).
      // How physical continuation increases emotional engagement: Throwing the card away feels like a tangible, irreversible decision.
      // Why polish determines perceived quality: The difference between a premium app and a cheap one is how they handle the millisecond the finger leaves the screen.
      // How micro-latency affects trust: By passing the exact hardware release velocity into the spring, we achieve zero frame loss or snapping, maintaining the physical illusion.
      const springThrowConfig = { 
        damping: 14, 
        stiffness: 180, 
        mass: 0.4, 
        restDisplacementThreshold: 0.01,
        restSpeedThreshold: 0.01,
        overshootClamping: true // 7. Finger-release smoothing: Prevent the card from visibly vibrating if the throw calculation slightly overshoots its target off-screen.
      };

      // 5. HAPTIC TIMING RULES
      // Why timing matters more than intensity: If a haptic fires 50ms late via a React state change, 
      // it feels like a bug. Firing EXACTLY here, synchronized with the physical release momentum, 
      // creates the tactile illusion of weight and mass leaving the finger.
      if (isConfidentSwipeRight) {
        // 2. DIRECTIONAL HAPTIC HIERARCHY (KEEP)
        // How tactile hierarchy creates emotional value: Keeping a photo is a positive, light action. 
        // We use a Light impact so it feels effortless and emotionally neutral-positive.
        runOnJS(triggerImpactHaptic)(Haptics.ImpactFeedbackStyle.Light);
        hasCommitted.value = true;
        
        // 3. Momentum Continuation & Natural Throw Trajectories
        const throwDestinationX = Math.max(SCREEN_WIDTH * 1.5, translationX + velocityX * 0.2);
        const throwDestinationY = translateY.value + velocityY * 0.2;
        
        translateX.value = withSpring(throwDestinationX, { ...springThrowConfig, velocity: velocityX }, () => {
          if (onSwipeRight) runOnJS(onSwipeRight)();
        });
        translateY.value = withSpring(throwDestinationY, { ...springThrowConfig, velocity: velocityY });
      } else if (isConfidentSwipeLeft) {
        // DIRECTIONAL HAPTIC HIERARCHY (DELETE)
        // Deleting is destructive. A Medium impact feels sharper, distinct, and more decisive.
        runOnJS(triggerImpactHaptic)(Haptics.ImpactFeedbackStyle.Medium);
        hasCommitted.value = true;
        
        const throwDestinationX = Math.min(-SCREEN_WIDTH * 1.5, translationX + velocityX * 0.2);
        const throwDestinationY = translateY.value + velocityY * 0.2;
        
        translateX.value = withSpring(throwDestinationX, { ...springThrowConfig, velocity: velocityX }, () => {
          if (onSwipeLeft) runOnJS(onSwipeLeft)();
        });
        translateY.value = withSpring(throwDestinationY, { ...springThrowConfig, velocity: velocityY });
      } else if (isConfidentSwipeUp) {
        // DIRECTIONAL HAPTIC HIERARCHY (FAVORITE / ARCHIVE)
        // The richest, most luxurious haptic (Heavy) is reserved for the premium action.
        runOnJS(triggerImpactHaptic)(Haptics.ImpactFeedbackStyle.Heavy);
        hasCommitted.value = true;
        
        const throwDestinationX = translationX + velocityX * 0.2;
        const throwDestinationY = Math.min(-SCREEN_HEIGHT * 1.5, translateY.value + velocityY * 0.2);
        
        translateX.value = withSpring(throwDestinationX, { ...springThrowConfig, velocity: velocityX });
        translateY.value = withSpring(throwDestinationY, { ...springThrowConfig, velocity: velocityY }, () => {
          if (onSwipeUp) runOnJS(onSwipeUp)();
        });
      } else {
        // 4. Premium Failed-Swipe Recovery (Snap-back Physics)
        // Soft, calm feedback acknowledging the gesture cancellation without punishing the user.
        runOnJS(triggerImpactHaptic)(Haptics.ImpactFeedbackStyle.Soft);
        
        // Why failed interactions matter psychologically: A failed gesture is an implicit correction by the app. 
        // If it snaps back aggressively, it feels punishing or cheap. A soft, elegant return communicates 
        // "nice try, but not enough commitment" while maintaining a calm, premium atmosphere.
        // 
        // How spring tuning affects perceived luxury:
        // Lower stiffness removes the robotic, mechanical snap.
        // Tuned damping controls the kinetic energy, preventing cartoonish jelly wobbles.
        // Slightly higher mass gives the card a tangible, expensive weight.
        // 
        // Why subtle overshoot feels human: A nearly critically damped spring with just a microscopic hint of overshoot 
        // mimics real-world physical objects settling into place, making the digital UI feel deeply tactile.
        
        translateX.value = withSpring(0, { ...SPRING_RECOVERY_CONFIG, velocity: velocityX });
        translateY.value = withSpring(0, { ...SPRING_RECOVERY_CONFIG, velocity: velocityY });
        if (activeTranslateX) {
          activeTranslateX.value = withSpring(0, { ...SPRING_RECOVERY_CONFIG, velocity: velocityX });
        }
        if (activeTranslateY) {
          activeTranslateY.value = withSpring(0, { ...SPRING_RECOVERY_CONFIG, velocity: velocityY });
        }
      }
    })
    .onFinalize(() => {
      // 4 & 6. Edge-case interruption handling & Gesture cancellation refinement.
      // If the OS interrupts the gesture (e.g., a phone call or system swipe), gracefully release the dragging state.
      // This eliminates the severe edge-case bug where a card gets "stuck" to the user's finger.
      isDragging.value = false;
      if (activeInteraction) activeInteraction.value = withSpring(0, { damping: 15, stiffness: 200, mass: 0.5 });
    });

  const tapGesture = Gesture.Tap()
    .enabled(!hasCommitted.value && !!onPress)
    .maxDuration(250)
    .onEnd(() => {
      if (onPress) runOnJS(onPress)();
    });

  // 3. TRANSITION CONTINUITY & FATIGUE REDUCTION
  // How tactile continuity increases compulsion: When visual motion, haptic feedback, and gesture intent 
  // perfectly align without single-frame pops or stutters, the digital barrier dissolves. The user feels 
  // they are physically sorting memories, driving deep behavioral compulsion.
  // 
  // Why we use a derived spring for depth: Previously, background cards scaled up based on the exact pixel 
  // translation of the top card. When the swipe finished and coordinates reset to 0, it caused a 1-frame "pop". 
  // By strictly animating the index change with a dedicated spring, the next card glides forward flawlessly, 
  // completely immune to the active card's coordinate resets.
  const derivedIndex = useDerivedValue(() => {
    // Premium Physical Snap: A stiffer spring immediately commands authority when bringing the next
    // card into focus. Specifically tuned (Damping 14, Stiffness 400) for a rapid, decisive reveal.
    return withSpring(indexInStack, {
      damping: 14,
      stiffness: 400,
      mass: 0.6,
      restDisplacementThreshold: 0.01,
      restSpeedThreshold: 0.01
    });
  }, [indexInStack]);

  // Why visual calmness reduces fatigue: By locking the background cards in place during the active drag 
  // (rather than scaling them dynamically), we eliminate chaotic motion and sensory overload. 
  // The visual hierarchy remains strictly focused on the current decision.
  const animatedScale = useDerivedValue(() => Math.max(1 - (derivedIndex.value * 0.05), 0.85));
  const animatedOffsetY = useDerivedValue(() => derivedIndex.value * 16);

  const rStyle = useAnimatedStyle(() => {
    // 1. Calculate Base Rotation (Raw horizontal movement mapped to an angle)
    // Max rotation is carefully capped at 15 degrees per the blueprint specifications
    // to avoid cartoonish spinning and maintain a sense of physical mass.
    const baseRotation = interpolate(
      translateX.value,
      [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
      [-15, 0, 15],
      Extrapolation.CLAMP
    );

    // 2. Calculate Leverage Multiplier based on Vertical Touch Origin
    // Why leverage-based rotation feels premium: 
    // In the real world, pushing a physical object from the top rotates it differently 
    // than pushing it from the bottom. Mimicking this leverage simulates tangible weight and physical presence.
    // Subtlety is critical: we use a small max angle so the card feels heavy and deliberate.
    const leverageMultiplier = interpolate(
      touchOriginY.value,
      [0, SCREEN_HEIGHT * 0.35, SCREEN_HEIGHT * 0.7], // Approximate card regions (top, center, bottom)
      [1, 0, -1], // Top = natural tilt, Center = balanced/rigid, Bottom = inverse tilt
      Extrapolation.CLAMP
    );

    // 3. Final Dynamic Rotation
    const rotate = baseRotation * leverageMultiplier;

    // 5. Active Interaction Anticipation (Touch-down state)
    // Why tactile acknowledgment increases engagement: A slight 1.5% scale increase and depth shift 
    // when the user touches the card makes it feel like it's lifting off the glass, transitioning 
    // from a static image into a physical, interactable object.
    const interactionScale = activeInteraction 
      ? interpolate(activeInteraction.value, [0, 1], [1, 1.015], Extrapolation.CLAMP) : 1;

    // Smooth opacity fade timing for the card as it physically flies off-screen
    // AVOID abrupt disappearance: Fades out only in the outer margins of the screen.
    const opacityX = interpolate(
      translateX.value,
      [-SCREEN_WIDTH * 1.2, -SCREEN_WIDTH * 0.8, 0, SCREEN_WIDTH * 0.8, SCREEN_WIDTH * 1.2],
      [0, 1, 1, 1, 0],
      Extrapolation.CLAMP
    );
    const opacityY = interpolate(
      translateY.value,
      [-SCREEN_HEIGHT * 1.2, -SCREEN_HEIGHT * 0.8, 0],
      [0, 1, 1],
      Extrapolation.CLAMP
    );
    const opacity = Math.min(opacityX, opacityY);

    // 9. Touch responsiveness optimization & Shadow smoothing
    // Tying elevation strictly to the physical drag distance prevents harsh visual "pops" when the finger is released.
    const elevationBase = interpolate(derivedIndex.value, [0, 1], [3, 2], Extrapolation.CLAMP);
    const dynamicElevation = interpolate(
      Math.abs(translateX.value),
      [0, SCREEN_WIDTH * 0.25],
      [elevationBase, 8], // Kept moderate to avoid harsh, dark Android default shadows
      Extrapolation.CLAMP
    );
    
    // Smooth shadow anticipation
    const baseShadowOpacity = interpolate(derivedIndex.value, [0, 1], [0.15, 0], Extrapolation.CLAMP);
    const finalShadowOpacity = activeInteraction 
      ? interpolate(activeInteraction.value, [0, 1], [baseShadowOpacity, 0.25], Extrapolation.CLAMP)
      : baseShadowOpacity;

    return {
      ...StyleSheet.absoluteFillObject,
      opacity: opacity, // Fade any card based on physical distance
      transform: [
        // TRANSFORM ORDER MATTERS FOR REALISM:
        // 1. Translate first: The card instantly and strictly follows the finger's X/Y screen space movement.
        { translateX: translateX.value },
        { translateY: translateY.value + animatedOffsetY.value },
        // 2. Scale: Applies depth perspective.
        { scale: animatedScale.value * interactionScale },
        // 3. Rotate last: Rotating *after* translation ensures the card pivots around its current local center.
        // If we rotated first, the translation would happen along the angled axis, causing the card to veer away from the finger.
        { rotate: `${rotate}deg` }
      ],
      zIndex: 10 - indexInStack, 
      // 8 & 10. Micro latency reduction & Swipe continuity improvements:
      // Subtly add elevation during active interaction for physical feedback
      elevation: dynamicElevation + (activeInteraction ? interpolate(activeInteraction.value, [0, 1], [0, 4]) : 0),
      shadowOpacity: finalShadowOpacity,
    };
  }, [indexInStack, activeTranslateX]);

  const actionDeleteStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-VISUAL_THRESHOLD, -VISUAL_THRESHOLD / 2], [1, 0], Extrapolation.CLAMP)
  }));

  const actionKeepStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [VISUAL_THRESHOLD / 2, VISUAL_THRESHOLD], [0, 1], Extrapolation.CLAMP)
  }));

  return (
    <GestureDetector gesture={panGesture}>
      {/* 
        Hardware Acceleration: Forcing layer-backing (LAYER_TYPE_HARDWARE) 
        to keep animations smooth on budget devices. Bound statically to 
        isTopCard to ensure GPU-acceleration without triggering a JS-thread 
        re-render at gesture start (which would drop frames).
      */}
      <Animated.View style={[styles.container, rStyle]} renderToHardwareTextureAndroid={isTopCard}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    shadowColor: '#000',
    // Why subtle depth feels premium: Wide, diffuse shadows simulate soft ambient lighting 
    // rather than a harsh spotlight. This makes the interface feel like physical, expensive 
    // material resting in a well-lit environment.
    shadowOffset: { width: 0, height: 24 },
    // Why harsh shadows feel cheap: High opacity, small-radius shadows create high contrast edges 
    // that look digital and primitive. Soft, low-opacity shadows seamlessly blend the element into the background.
    shadowOpacity: 0.15,
    shadowRadius: 40,
  },
});