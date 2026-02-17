/**
 * Tournament Events Hook
 * 
 * React hook for managing tournament events.
 * 
 * Issue #256: Implement tournament event system
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TournamentEvent,
  EventFormat,
  EventType,
  EventHistory,
  Registration,
  EventStandings,
  createTournamentEvent,
  registerPlayer,
  unregisterPlayer,
  openRegistration,
  startEvent,
  completeEvent,
  cancelEvent,
  addToEventHistory,
  getTotalPrizes,
  TOURNAMENT_STORAGE_KEYS,
} from '@/lib/tournament-events';
import { useLocalStorage } from './use-local-storage';
import { PlayerId } from '@/lib/game-state/types';

export interface UseTournamentEventsReturn {
  // Events
  activeEvents: TournamentEvent[];
  myEvents: TournamentEvent[];
  eventHistory: EventHistory[];
  
  // Event Actions
  createEvent: (
    name: string,
    format: EventFormat,
    eventType: EventType,
    options?: Partial<TournamentEvent>
  ) => TournamentEvent;
  updateEvent: (eventId: string, updates: Partial<TournamentEvent>) => void;
  deleteEvent: (eventId: string) => void;
  
  // Registration
  registerForEvent: (eventId: string, playerId: PlayerId, displayName: string, deckName?: string) => void;
  unregisterFromEvent: (eventId: string, playerId: PlayerId) => void;
  
  // Event Management
  openEventRegistration: (eventId: string) => void;
  startTournament: (eventId: string) => void;
  finishTournament: (eventId: string, standings: EventStandings[]) => void;
  cancelTournament: (eventId: string) => void;
  
  // Stats
  totalPrizes: { points: number; events: number };
  formatStats: Record<EventFormat, number>;
}

const MAX_ACTIVE_EVENTS = 50;

export function useTournamentEvents(playerId: PlayerId, playerName: string): UseTournamentEventsReturn {
  // Active events
  const [activeEvents, setActiveEvents] = useLocalStorage<TournamentEvent[]>(
    TOURNAMENT_STORAGE_KEYS.ACTIVE_EVENTS,
    []
  );
  
  // Event history
  const [eventHistory, setEventHistory] = useLocalStorage<EventHistory[]>(
    TOURNAMENT_STORAGE_KEYS.EVENT_HISTORY,
    []
  );
  
  // My registrations (for quick lookup)
  const [myRegistrations, setMyRegistrations] = useLocalStorage<{ eventId: string }[]>(
    TOURNAMENT_STORAGE_KEYS.MY_REGISTRATIONS,
    []
  );
  
  // Filter to get events the player is registered for
  const myEvents = useMemo(() => {
    const eventIds = new Set(myRegistrations.map(r => r.eventId));
    return activeEvents.filter(e => eventIds.has(e.id));
  }, [activeEvents, myRegistrations]);
  
  // Create event
  const createEvent = useCallback((
    name: string,
    format: EventFormat,
    eventType: EventType,
    options?: Partial<TournamentEvent>
  ) => {
    const event = createTournamentEvent(name, format, eventType, playerId, options);
    setActiveEvents(prev => [event, ...prev].slice(0, MAX_ACTIVE_EVENTS));
    return event;
  }, [playerId, setActiveEvents]);
  
  // Update event
  const updateEvent = useCallback((eventId: string, updates: Partial<TournamentEvent>) => {
    setActiveEvents(prev =>
      prev.map(e => e.id === eventId ? { ...e, ...updates } : e)
    );
  }, [setActiveEvents]);
  
  // Delete event
  const deleteEvent = useCallback((eventId: string) => {
    setActiveEvents(prev => prev.filter(e => e.id !== eventId));
  }, [setActiveEvents]);
  
  // Register for event
  const registerForEvent = useCallback((
    eventId: string,
    playerId: PlayerId,
    displayName: string,
    deckName?: string
  ) => {
    setActiveEvents(prev =>
      prev.map(e => {
        if (e.id !== eventId) return e;
        try {
          return registerPlayer(e, playerId, displayName, deckName);
        } catch {
          return e;
        }
      })
    );
    
    // Track registration
    setMyRegistrations(prev => {
      if (prev.some(r => r.eventId === eventId)) return prev;
      return [...prev, { eventId }];
    });
  }, [setActiveEvents, setMyRegistrations]);
  
  // Unregister from event
  const unregisterFromEvent = useCallback((eventId: string, playerId: PlayerId) => {
    setActiveEvents(prev =>
      prev.map(e => {
        if (e.id !== eventId) return e;
        return unregisterPlayer(e, playerId);
      })
    );
    
    // Remove from my registrations
    setMyRegistrations(prev => prev.filter(r => r.eventId !== eventId));
  }, [setActiveEvents, setMyRegistrations]);
  
  // Open registration
  const openEventRegistration = useCallback((eventId: string) => {
    setActiveEvents(prev =>
      prev.map(e => e.id === eventId ? openRegistration(e) : e)
    );
  }, [setActiveEvents]);
  
  // Start tournament
  const startTournament = useCallback((eventId: string) => {
    setActiveEvents(prev => {
      return prev.map(e => {
        if (e.id !== eventId) return e;
        try {
          return startEvent(e);
        } catch (error) {
          console.error('Failed to start tournament:', error);
          return e;
        }
      });
    });
  }, [setActiveEvents]);
  
  // Finish tournament
  const finishTournament = useCallback((eventId: string, standings: EventStandings[]) => {
    setActiveEvents(prev => {
      const event = prev.find(e => e.id === eventId);
      if (!event) return prev;
      
      // Complete event
      const completedEvent = completeEvent(event, standings);
      
      // Add to history
      const myResult = standings.find(s => s.playerId === playerId);
      const result: EventHistory['result'] = myResult
        ? myResult.placement === 1 ? '1st'
        : myResult.placement === 2 ? '2nd'
        : myResult.placement <= 8 ? '3rd-8th'
        : '9th+'
        : 'dnf';
      
      setEventHistory(h => addToEventHistory(h, completedEvent, result));
      
      // Update or remove from active
      return prev.map(e => e.id === eventId ? completedEvent : e);
    });
  }, [setActiveEvents, setEventHistory, playerId]);
  
  // Cancel tournament
  const cancelTournament = useCallback((eventId: string) => {
    setActiveEvents(prev =>
      prev.map(e => e.id === eventId ? cancelEvent(e) : e)
    );
  }, [setActiveEvents]);
  
  // Total prizes
  const totalPrizes = useMemo(() => getTotalPrizes(eventHistory), [eventHistory]);
  
  // Format stats
  const formatStats = useMemo(() => {
    const stats: Record<EventFormat, number> = {
      standard: 0,
      draft: 0,
      sealed: 0,
      commander: 0,
      modern: 0,
      legacy: 0,
      pauper: 0,
    };
    
    eventHistory.forEach(e => {
      stats[e.format]++;
    });
    
    return stats;
  }, [eventHistory]);
  
  return {
    activeEvents,
    myEvents,
    eventHistory,
    createEvent,
    updateEvent,
    deleteEvent,
    registerForEvent,
    unregisterFromEvent,
    openEventRegistration,
    startTournament,
    finishTournament,
    cancelTournament,
    totalPrizes,
    formatStats,
  };
}
