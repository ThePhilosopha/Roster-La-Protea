import React, { useState, useEffect, useMemo, useCallback } from 'react';

// --- UTILITIES & TYPES ---

type ShiftType = 'Normal' | 'Half';
type EmploymentStatus = 'Permanent' | 'Casual';
type DisplayMode = 'dots' | 'colors';

interface ShiftOverride {
    date: string;
    startTime?: string;
    endTime?: string;
    isDayOff?: boolean;
    shiftType?: ShiftType;
}

interface StaffMember {
    id: string;
    name: string;
    role: string;
    cycleStartDate: string;
    patternOn: number;
    patternOff: number;
    shiftType: ShiftType;
    status: EmploymentStatus;
    overrides?: ShiftOverride[];
}

interface DayStatus {
    date: Date;
    isWorkDay: boolean;
    dayName: string;
    dayNumber: number;
    fullDateStr: string;
}

// --- LOGIC ---

const getLocalDateString = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const generateDateRange = (startDate: Date, days: number = 60): DayStatus[] => {
    const dates: DayStatus[] = [];
    const current = new Date(startDate);

    for (let i = 0; i < days; i++) {
        const d = new Date(current);
        d.setDate(current.getDate() + i);

        dates.push({
            date: d,
            isWorkDay: false,
            dayName: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
            dayNumber: d.getDate(),
            fullDateStr: getLocalDateString(d),
        });
    }
    return dates;
};

const isStaffWorking = (staff: StaffMember, targetDateStr: string): boolean => {
    const [csY, csM, csD] = staff.cycleStartDate.split('-').map(Number);
    const cycleStart = new Date(csY, csM - 1, csD);

    const [tY, tM, tD] = targetDateStr.split('-').map(Number);
    const target = new Date(tY, tM - 1, tD);

    const diffTime = target.getTime() - cycleStart.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    const totalCycleLength = staff.patternOn + staff.patternOff;
    const dayInCycle = ((diffDays % totalCycleLength) + totalCycleLength) % totalCycleLength;

    return dayInCycle < staff.patternOn;
};

interface ShiftState {
    isWorking: boolean;
    shiftType: ShiftType | 'Off';
    visualType: 'Solid' | 'Hollow' | 'None' | 'Dash';
    label: string;
}

const calculateShiftState = (staff: StaffMember, day: DayStatus): ShiftState => {
    const override = staff.overrides?.find(o => o.date === day.fullDateStr);

    if (override?.isDayOff) {
        return { isWorking: false, shiftType: 'Off', visualType: 'Dash', label: 'Day Off (Manual)' };
    }

    if (override?.shiftType) {
        if (override.shiftType === 'Half') {
            return { isWorking: true, shiftType: 'Half', visualType: 'Hollow', label: 'Half Shift (Manual)' };
        }
        return { isWorking: true, shiftType: 'Normal', visualType: 'Solid', label: 'Normal Shift (Manual)' };
    }

    const working = isStaffWorking(staff, day.fullDateStr);

    if (!working) {
        return { isWorking: false, shiftType: 'Off', visualType: 'Dash', label: 'Off' };
    }

    return { isWorking: true, shiftType: 'Normal', visualType: 'Solid', label: 'Normal Shift' };
};

const getShiftTimes = (staff: StaffMember, dateStr: string, shiftType: ShiftType): { start: string; end: string } => {
    const override = staff.overrides?.find(o => o.date === dateStr);
    if (override?.startTime && override?.endTime) return { start: override.startTime, end: override.endTime };
    if (shiftType === 'Half') return { start: '08:00', end: '13:00' };
    return { start: '08:00', end: '17:00' };
};

// --- DATA HOOK ---

import { supabase } from './supabaseClient';

// Fallback staff removed to prevent data flashing. Initial state is now empty or from local storage.

const useRosterData = () => {
    const [staff, setStaff] = useState<StaffMember[]>(() => {
        const local = localStorage.getItem('protea_staff_data');
        try {
            return local ? JSON.parse(local) : [];
        } catch (e) {
            return [];
        }
    });
    const [loading, setLoading] = useState(true);

    const fetchStaff = useCallback(async () => {
        try {
            if (!supabase) {
                console.warn('Supabase client not initialized. Using local data only.');
                const local = localStorage.getItem('protea_staff_data');
                if (local) {
                    setStaff(JSON.parse(local));
                }
                // No error thrown, just graceful degradation or maybe we want to show an alert?
                // For now, let's allow it to "load" empty so the user can verify the app works at least.
                return;
            }

            const { data, error } = await supabase
                .from('staff')
                .select('*')
                .order('display_order', { ascending: true });

            if (error) throw error;

            if (data && data.length > 0) {
                const mappedStaff: StaffMember[] = data.map((item: any) => ({
                    id: item.id,
                    name: item.name,
                    role: item.role,
                    cycleStartDate: item.cycle_start_date,
                    patternOn: item.pattern_on,
                    patternOff: item.pattern_off,
                    shiftType: item.shift_type,
                    status: item.status,
                    overrides: item.overrides || []
                }));
                setStaff(mappedStaff);
            }
        } catch (error) {
            console.error('Error fetching staff from Supabase:', error);
            // Fallback to local storage if Supabase fails? Or just keep fallback staff.
            // Keeping current fallback/local storage logic just in case for now might be safer
            // but let's stick to the prompt: fix it to save to Supabase.
            // If Supabase fetch fails, we might still want to try localStorage as a backup?
            const local = localStorage.getItem('protea_staff_data');
            if (local) {
                try { setStaff(JSON.parse(local)); } catch (e) { }
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStaff();
    }, [fetchStaff]);

    const updateStaffData = useCallback(async (newStaff: StaffMember[]) => {
        // Optimistic update
        setStaff(newStaff);

        // Also save to local storage as a backup/cache
        localStorage.setItem('protea_staff_data', JSON.stringify(newStaff));

        try {
            // Separate existing staff (valid UUIDs) from new staff
            const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

            const existingStaff = newStaff.filter(p => isValidUUID(p.id));
            const newStaffMembers = newStaff.filter(p => !isValidUUID(p.id));

            // Update existing staff
            if (existingStaff.length > 0) {
                const updatePayload = existingStaff.map((person, index) => ({
                    id: person.id,
                    name: person.name,
                    role: person.role,
                    cycle_start_date: person.cycleStartDate,
                    pattern_on: person.patternOn,
                    pattern_off: person.patternOff,
                    shift_type: person.shiftType,
                    status: person.status,
                    overrides: person.overrides || [],
                    display_order: newStaff.indexOf(person)
                }));

                const { error: updateError } = await supabase
                    .from('staff')
                    .upsert(updatePayload, { onConflict: 'id' });

                if (updateError) throw updateError;
            }

            // Insert new staff (without ID, let Supabase generate)
            if (newStaffMembers.length > 0) {
                const insertPayload = newStaffMembers.map((person) => ({
                    name: person.name,
                    role: person.role,
                    cycle_start_date: person.cycleStartDate,
                    pattern_on: person.patternOn,
                    pattern_off: person.patternOff,
                    shift_type: person.shiftType,
                    status: person.status,
                    overrides: person.overrides || [],
                    display_order: newStaff.indexOf(person)
                }));

                const { error: insertError } = await supabase
                    .from('staff')
                    .insert(insertPayload);

                if (insertError) throw insertError;
            }

            // Refetch to get correct IDs for newly inserted staff
            const { data: refreshedData, error: fetchError } = await supabase
                .from('staff')
                .select('*')
                .order('display_order', { ascending: true });

            if (fetchError) throw fetchError;

            if (refreshedData) {
                const mappedStaff: StaffMember[] = refreshedData.map((item: any) => ({
                    id: item.id,
                    name: item.name,
                    role: item.role,
                    cycleStartDate: item.cycle_start_date,
                    patternOn: item.pattern_on,
                    patternOff: item.pattern_off,
                    shiftType: item.shift_type,
                    status: item.status,
                    overrides: item.overrides || []
                }));
                setStaff(mappedStaff);
                localStorage.setItem('protea_staff_data', JSON.stringify(mappedStaff));
            }

        } catch (error) {
            console.error('Error saving to Supabase:', error);
            throw error; // Re-throw so UI can show error
        }
    }, []);

    return { staff, updateStaffData, loading };
};

// --- COMPONENTS ---

const RosterHeader: React.FC<{
    lastUpdated: Date;
    darkMode: boolean;
    toggleDarkMode: () => void;
    onLoginClick: () => void;
    isAdmin: boolean;
}> = ({ lastUpdated, darkMode, toggleDarkMode, onLoginClick, isAdmin }) => (
    <header style={{ marginBottom: '3rem', paddingTop: '2rem' }}>
        <div className="animate-fade-in" style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: `1px solid ${darkMode ? 'rgba(242,239,233,0.2)' : 'rgba(18,16,14,0.2)'}`,
            paddingBottom: '0.5rem',
            marginBottom: '2rem'
        }}>
            <div className="font-sans" style={{
                fontSize: '10px',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                display: 'flex',
                gap: '1rem',
                fontWeight: 700,
                opacity: 0.9,
                color: darkMode ? '#F2EFE9' : '#12100E'
            }}>
                <span>Est. 2024</span>
                {isAdmin && <span style={{ color: '#8F3434', fontWeight: 700 }}>ADMIN ACCESS</span>}
            </div>
            <div className="font-sans" style={{
                fontSize: '10px',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                fontWeight: 700,
                opacity: 0.9,
                color: darkMode ? '#F2EFE9' : '#12100E'
            }}>
                {lastUpdated.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                    onClick={() => window.print()}
                    className="font-sans print-btn"
                    style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '10px',
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        fontWeight: 700,
                        opacity: 0.9,
                        color: darkMode ? '#F2EFE9' : '#12100E'
                    }}
                >
                    Print
                </button>
                <button
                    onClick={toggleDarkMode}
                    className="font-sans"
                    style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '10px',
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        fontWeight: 700,
                        opacity: 0.9,
                        color: darkMode ? '#F2EFE9' : '#12100E'
                    }}
                >
                    {darkMode ? 'Light' : 'Dark'}
                </button>
                <button
                    onClick={onLoginClick}
                    className="font-sans"
                    style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '10px',
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        fontWeight: 700,
                        opacity: 0.9,
                        color: darkMode ? '#F2EFE9' : '#12100E'
                    }}
                >
                    {isAdmin ? 'Portal' : 'Admin'}
                </button>
            </div>
        </div>
        <div style={{ textAlign: 'center', position: 'relative' }}>
            <h1 className="font-serif" style={{
                fontSize: 'clamp(2.5rem, 6vw, 4.5rem)',
                marginBottom: '0.5rem',
                letterSpacing: '0.3em',
                color: darkMode ? '#F2EFE9' : '#12100E',
                fontWeight: 600,
                textTransform: 'uppercase'
            }}>
                Protea Ridge
            </h1>
            <div style={{
                height: '1px',
                width: '6rem',
                background: darkMode ? '#F2EFE9' : '#12100E',
                margin: '1.5rem auto'
            }}></div>
            <p className="font-sans" style={{
                fontSize: '0.75rem',
                letterSpacing: '0.3em',
                textTransform: 'uppercase',
                marginTop: '1rem',
                fontWeight: 700,
                opacity: 0.8,
                color: darkMode ? '#F2EFE9' : '#12100E'
            }}>
                Staff Roster & Schedule
            </p>
        </div>
    </header>
);

interface SelectedShift {
    staffId: string;
    dateStr: string;
    staffName: string;
    shiftType: string;
    label: string;
    start: string;
    end: string;
    isDayOff: boolean;
}

const RosterGrid: React.FC<{
    staff: StaffMember[];
    dates: DayStatus[];
    isAdmin?: boolean;
    onUpdateStaff?: (newStaff: StaffMember[]) => void;
    displayMode?: DisplayMode;
    darkMode: boolean;
}> = ({ staff, dates, isAdmin = false, onUpdateStaff, displayMode = 'dots', darkMode }) => {
    const todayStr = getLocalDateString(new Date());
    const [selectedShift, setSelectedShift] = useState<SelectedShift | null>(null);

    const handleQuickCycle = (person: StaffMember, day: DayStatus, shiftState: ShiftState) => {
        if (!onUpdateStaff) return;
        const newStaff = staff.map(p => {
            if (p.id !== person.id) return p;
            const currentOverrides = p.overrides ? [...p.overrides] : [];
            const idx = currentOverrides.findIndex(o => o.date === day.fullDateStr);
            let nextState: 'Normal' | 'Half' | 'Off' = 'Half';

            if (shiftState.shiftType === 'Half') nextState = 'Off';
            else if (shiftState.shiftType === 'Off' || !shiftState.isWorking) nextState = 'Normal';

            if (idx >= 0) currentOverrides.splice(idx, 1);

            if (nextState === 'Off') {
                currentOverrides.push({ date: day.fullDateStr, isDayOff: true });
            } else if (nextState === 'Half') {
                currentOverrides.push({ date: day.fullDateStr, startTime: '08:00', endTime: '13:00', isDayOff: false, shiftType: 'Half' });
            } else {
                const baseWorking = isStaffWorking(p, day.fullDateStr);
                if (!baseWorking) {
                    currentOverrides.push({ date: day.fullDateStr, startTime: '08:00', endTime: '17:00', isDayOff: false, shiftType: 'Normal' });
                }
            }
            return { ...p, overrides: currentOverrides };
        });
        onUpdateStaff(newStaff);
    };

    const handleShiftClick = (person: StaffMember, day: DayStatus, shiftState: ShiftState) => {
        if (isAdmin && onUpdateStaff) {
            handleQuickCycle(person, day, shiftState);
            return;
        }
        if (!shiftState.isWorking) return;
        const times = getShiftTimes(person, day.fullDateStr, shiftState.shiftType as ShiftType);
        setSelectedShift({
            staffId: person.id,
            dateStr: day.fullDateStr,
            staffName: person.name,
            shiftType: shiftState.shiftType,
            label: shiftState.label,
            start: times.start,
            end: times.end,
            isDayOff: !shiftState.isWorking
        });
    };

    const bgColor = darkMode ? '#2A231E' : '#F2EFE9';
    const textColor = darkMode ? '#F2EFE9' : '#12100E';
    const borderColor = darkMode ? 'rgba(242,239,233,0.2)' : 'rgba(18,16,14,0.2)';

    return (
        <>
            <div style={{ width: '100%' }}>
                <div style={{ overflowX: 'auto', paddingBottom: '3rem' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr>
                                <th style={{
                                    position: 'sticky',
                                    left: 0,
                                    zIndex: 30,
                                    background: bgColor,
                                    padding: '1.25rem',
                                    minWidth: '200px',
                                    borderBottom: `1px solid ${textColor}`,
                                    textAlign: 'left',
                                    verticalAlign: 'bottom',
                                    boxShadow: '4px 0 15px -5px rgba(0,0,0,0.05)'
                                }}>
                                    <span className="font-sans" style={{
                                        fontSize: '10px',
                                        letterSpacing: '0.1em',
                                        textTransform: 'uppercase',
                                        fontWeight: 700,
                                        color: textColor
                                    }}>The Personnel</span>
                                </th>
                                {dates.map((day) => {
                                    const isToday = day.fullDateStr === todayStr;
                                    return (
                                        <th key={day.fullDateStr} style={{
                                            minWidth: '48px',
                                            padding: '0.25rem 0.25rem 1.25rem',
                                            textAlign: 'center',
                                            verticalAlign: 'bottom',
                                            borderBottom: `1px solid ${borderColor}`,
                                            fontWeight: 'normal',
                                            transition: 'all 0.3s',
                                            background: isToday ? textColor : 'transparent',
                                            color: isToday ? bgColor : textColor
                                        }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                                                <span className="font-sans" style={{
                                                    fontSize: '10px',
                                                    letterSpacing: '0.1em',
                                                    textTransform: 'uppercase',
                                                    transform: 'rotate(-90deg)',
                                                    transformOrigin: 'center',
                                                    marginBottom: '1.5rem',
                                                    fontWeight: 700,
                                                    opacity: isToday ? 1 : 0.8
                                                }}>
                                                    {day.dayName}
                                                </span>
                                                <span className="font-serif" style={{ fontSize: '0.875rem' }}>{day.dayNumber}</span>
                                            </div>
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {staff.map((person) => (
                                <tr key={person.id} className="roster-row">
                                    <td style={{
                                        position: 'sticky',
                                        left: 0,
                                        zIndex: 20,
                                        padding: '1.25rem',
                                        borderBottom: `1px solid ${borderColor}`,
                                        boxShadow: '4px 0 15px -5px rgba(0,0,0,0.05)',
                                        transition: 'colors 0.2s',
                                        background: bgColor
                                    }}>
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                <span className="font-serif" style={{ fontSize: '1.25rem', lineHeight: 1, fontWeight: 700, color: textColor }}>{person.name}</span>
                                                {person.status === 'Casual' && (
                                                    <span style={{
                                                        fontSize: '9px',
                                                        border: `1px solid ${textColor}`,
                                                        padding: '0 0.25rem',
                                                        textTransform: 'uppercase',
                                                        fontWeight: 700,
                                                        color: textColor
                                                    }}>Casual</span>
                                                )}
                                            </div>
                                            <span className="font-sans" style={{
                                                fontSize: '10px',
                                                letterSpacing: '0.1em',
                                                textTransform: 'uppercase',
                                                fontWeight: 700,
                                                opacity: 0.9,
                                                color: darkMode ? '#F2EFE9' : '#5C554F',
                                                marginTop: '0.5rem'
                                            }}>{person.role}</span>
                                        </div>
                                    </td>
                                    {dates.map((day) => {
                                        const shift = calculateShiftState(person, day);
                                        const isToday = day.fullDateStr === todayStr;
                                        const isWeekend = day.dayName === 'SAT' || day.dayName === 'SUN';

                                        let cellBg = 'transparent';
                                        if (isWeekend) cellBg = darkMode ? 'rgba(242,239,233,0.05)' : 'rgba(92,85,79,0.1)';
                                        if (isToday) cellBg = 'rgba(143,52,52,0.1)';

                                        return (
                                            <td
                                                key={`${person.id}-${day.fullDateStr}`}
                                                onClick={() => handleShiftClick(person, day, shift)}
                                                className="roster-cell"
                                                style={{
                                                    textAlign: 'center',
                                                    padding: 0,
                                                    borderBottom: `1px solid ${borderColor}`,
                                                    height: '5rem',
                                                    width: '3rem',
                                                    position: 'relative',
                                                    transition: 'all 0.15s ease',
                                                    background: cellBg,
                                                    cursor: (isAdmin || shift.isWorking) ? 'pointer' : 'default'
                                                }}
                                            >
                                                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    {displayMode === 'dots' ? (
                                                        <>
                                                            {shift.visualType === 'Solid' && <div style={{ width: '0.75rem', height: '0.75rem', borderRadius: '50%', background: textColor }} />}
                                                            {shift.visualType === 'Hollow' && <div style={{ width: '0.75rem', height: '0.75rem', borderRadius: '50%', border: `2px solid ${textColor}` }} />}
                                                            {shift.visualType === 'Dash' && <div style={{ width: '0.75rem', height: '1px', background: darkMode ? 'rgba(242,239,233,0.5)' : 'rgba(18,16,14,0.5)' }} />}
                                                        </>
                                                    ) : (
                                                        <div style={{
                                                            width: '2.5rem',
                                                            height: '4rem',
                                                            borderRadius: '0.25rem',
                                                            background: !shift.isWorking
                                                                ? 'rgba(128,128,128,0.4)'
                                                                : shift.shiftType === 'Half'
                                                                    ? 'rgba(251,146,60,0.6)'
                                                                    : 'rgba(34,197,94,0.5)'
                                                        }} />
                                                    )}
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}

                            {/* Total Staff Count Row */}
                            <tr style={{ borderTop: `2px solid ${textColor}` }}>
                                <td style={{
                                    position: 'sticky',
                                    left: 0,
                                    zIndex: 20,
                                    padding: '1.25rem',
                                    background: bgColor,
                                    borderBottom: `1px solid ${borderColor}`
                                }}>
                                    <div className="font-sans" style={{
                                        fontWeight: 700,
                                        fontSize: '0.75rem',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.1em',
                                        color: textColor,
                                        opacity: 0.8
                                    }}>
                                        On Duty
                                    </div>
                                </td>
                                {dates.map(day => {
                                    const count = staff.filter(p => calculateShiftState(p, day).isWorking).length;
                                    return (
                                        <td key={`total-${day.fullDateStr}`} className="font-sans" style={{
                                            textAlign: 'center',
                                            padding: '1rem 0',
                                            fontSize: '0.75rem',
                                            fontWeight: 700,
                                            opacity: 0.5,
                                            color: textColor,
                                            borderBottom: `1px solid ${borderColor}`
                                        }}>
                                            {count}
                                        </td>
                                    )
                                })}
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Detail Modal */}
            {selectedShift && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 100,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '1rem'
                }}>
                    <div
                        style={{
                            position: 'absolute',
                            inset: 0,
                            background: darkMode ? 'rgba(18,16,14,0.8)' : 'rgba(242,239,233,0.6)',
                            backdropFilter: 'blur(4px)'
                        }}
                        onClick={() => setSelectedShift(null)}
                    />
                    <div style={{
                        background: bgColor,
                        border: `1px solid ${textColor}`,
                        padding: '1.5rem',
                        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
                        width: '100%',
                        maxWidth: '20rem',
                        position: 'relative',
                        zIndex: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        textAlign: 'center'
                    }}>
                        <h3 className="font-serif" style={{ fontSize: '1.5rem', fontWeight: 700, color: textColor }}>{selectedShift.staffName}</h3>
                        <div className="font-sans" style={{
                            fontSize: '9px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.1em',
                            opacity: 0.6,
                            fontWeight: 700,
                            color: textColor,
                            marginBottom: '1rem'
                        }}>
                            {new Date(selectedShift.dateStr).toLocaleDateString()}
                        </div>
                        <div style={{
                            padding: '1rem 0',
                            borderTop: `1px solid ${borderColor}`,
                            borderBottom: `1px solid ${borderColor}`,
                            width: '100%'
                        }}>
                            <div className="font-serif" style={{ fontSize: '1.875rem', color: textColor }}>
                                {selectedShift.start} – {selectedShift.end}
                            </div>
                        </div>
                        <button
                            onClick={() => setSelectedShift(null)}
                            className="font-sans"
                            style={{
                                marginTop: '1rem',
                                fontSize: '9px',
                                textTransform: 'uppercase',
                                letterSpacing: '0.1em',
                                textDecoration: 'underline',
                                fontWeight: 700,
                                color: textColor,
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer'
                            }}
                        >Close</button>
                    </div>
                </div>
            )}
        </>
    );
};

const AdminModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    isLoggedIn: boolean;
    onLogin: () => void;
    onLogout: () => void;
    staffData: StaffMember[];
    onUpdateStaff: (staff: StaffMember[]) => Promise<void>;
    onImport: (file: File) => void;
    onExport: () => void;
    darkMode: boolean;
}> = ({ isOpen, onClose, isLoggedIn, onLogin, onLogout, staffData, onUpdateStaff, onImport, onExport, darkMode }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [activeTab, setActiveTab] = useState('staff');
    const [localStaff, setLocalStaff] = useState<StaffMember[]>(staffData);
    const [isAdding, setIsAdding] = useState(false);
    const [isEditing, setIsEditing] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<Partial<StaffMember>>({});
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => { setLocalStaff(staffData); setHasUnsavedChanges(false); }, [staffData, isOpen]);

    if (!isOpen) return null;

    const bgColor = darkMode ? '#2A231E' : '#F2EFE9';
    const textColor = darkMode ? '#F2EFE9' : '#12100E';
    const borderColor = darkMode ? '#F2EFE9' : '#12100E';

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        if (username.toLowerCase() === 'shane' && password === 'admin123') onLogin();
    };

    const handleDelete = (id: string) => {
        if (confirm('Remove staff member?')) {
            setLocalStaff(localStaff.filter(s => s.id !== id));
            setHasUnsavedChanges(true);
        }
    };

    const handleSaveStaff = () => {
        if (!editForm.name) return;
        const newStaff = isAdding
            ? [...localStaff, editForm as StaffMember]
            : localStaff.map(s => s.id === editForm.id ? editForm as StaffMember : s);
        setLocalStaff(newStaff);
        setHasUnsavedChanges(true);
        setIsAdding(false);
        setIsEditing(null);
        setEditForm({});
    };

    const handleSaveAllChanges = async () => {
        setIsSaving(true);
        setSaveMessage(null);
        try {
            await onUpdateStaff(localStaff);
            setHasUnsavedChanges(false);
            setSaveMessage({ type: 'success', text: 'Changes saved to Supabase!' });
            setTimeout(() => setSaveMessage(null), 3000);
        } catch (error) {
            setSaveMessage({ type: 'error', text: 'Failed to save. Please try again.' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: darkMode ? 'rgba(42,35,30,0.95)' : 'rgba(242,239,233,0.95)',
            backdropFilter: 'blur(12px)'
        }}>
            <div style={{
                background: bgColor,
                border: `1px solid ${borderColor}`,
                padding: '2rem',
                maxWidth: '42rem',
                width: '100%',
                height: '80vh',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
                position: 'relative'
            }}>
                <button
                    onClick={onClose}
                    className="font-sans"
                    style={{
                        position: 'absolute',
                        top: '1rem',
                        right: '1rem',
                        fontSize: '0.75rem',
                        textTransform: 'uppercase',
                        fontWeight: 700,
                        color: textColor,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer'
                    }}
                >{hasUnsavedChanges ? '×' : 'Close'}</button>
                <h2 className="font-serif" style={{ fontSize: '1.875rem', marginBottom: '0.5rem', color: textColor }}>Admin Portal</h2>
                {hasUnsavedChanges && (
                    <div className="font-sans" style={{ fontSize: '11px', color: '#D4A017', marginBottom: '1rem', fontWeight: 600 }}>
                        ● Unsaved changes
                    </div>
                )}

                {!isLoggedIn ? (
                    <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '24rem', margin: '2.5rem auto 0', width: '100%' }}>
                        <input
                            type="text"
                            placeholder="Username"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            className="font-serif"
                            style={{
                                width: '100%',
                                background: 'transparent',
                                borderBottom: `2px solid ${borderColor}`,
                                border: 'none',
                                borderBottomWidth: '2px',
                                borderBottomStyle: 'solid',
                                borderBottomColor: borderColor,
                                padding: '0.5rem 0',
                                fontSize: '1.125rem',
                                color: textColor,
                                outline: 'none'
                            }}
                        />
                        <input
                            type="password"
                            placeholder="Password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className="font-serif"
                            style={{
                                width: '100%',
                                background: 'transparent',
                                border: 'none',
                                borderBottomWidth: '2px',
                                borderBottomStyle: 'solid',
                                borderBottomColor: borderColor,
                                padding: '0.5rem 0',
                                fontSize: '1.125rem',
                                color: textColor,
                                outline: 'none'
                            }}
                        />
                        <button
                            type="submit"
                            className="font-sans"
                            style={{
                                width: '100%',
                                background: textColor,
                                color: bgColor,
                                padding: '1rem',
                                fontSize: '0.75rem',
                                textTransform: 'uppercase',
                                letterSpacing: '0.1em',
                                fontWeight: 700,
                                border: 'none',
                                cursor: 'pointer'
                            }}
                        >Login</button>
                    </form>
                ) : (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', gap: '1rem', borderBottom: `1px solid ${darkMode ? 'rgba(242,239,233,0.2)' : 'rgba(18,16,14,0.2)'}`, marginBottom: '1rem', paddingBottom: '0.5rem' }}>
                            <button
                                onClick={() => setActiveTab('staff')}
                                className="font-sans"
                                style={{
                                    fontSize: '0.75rem',
                                    textTransform: 'uppercase',
                                    fontWeight: 700,
                                    color: activeTab === 'staff' ? '#8F3434' : textColor,
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer'
                                }}
                            >Manage Staff</button>
                            <button
                                onClick={() => setActiveTab('data')}
                                className="font-sans"
                                style={{
                                    fontSize: '0.75rem',
                                    textTransform: 'uppercase',
                                    fontWeight: 700,
                                    color: activeTab === 'data' ? '#8F3434' : textColor,
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer'
                                }}
                            >Data / Import</button>
                        </div>

                        {activeTab === 'data' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <button
                                    onClick={onExport}
                                    className="font-sans"
                                    style={{
                                        width: '100%',
                                        padding: '1rem',
                                        border: `1px solid ${borderColor}`,
                                        fontSize: '0.75rem',
                                        textTransform: 'uppercase',
                                        fontWeight: 700,
                                        color: textColor,
                                        background: 'transparent',
                                        cursor: 'pointer'
                                    }}
                                >Export CSV</button>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type="file"
                                        accept=".csv"
                                        onChange={(e) => e.target.files && onImport(e.target.files[0])}
                                        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                                    />
                                    <button
                                        className="font-sans"
                                        style={{
                                            width: '100%',
                                            padding: '1rem',
                                            border: `1px solid ${borderColor}`,
                                            fontSize: '0.75rem',
                                            textTransform: 'uppercase',
                                            fontWeight: 700,
                                            color: textColor,
                                            background: 'transparent',
                                            cursor: 'pointer'
                                        }}
                                    >Import CSV</button>
                                </div>
                                <button
                                    onClick={onLogout}
                                    className="font-sans"
                                    style={{
                                        width: '100%',
                                        padding: '1rem',
                                        border: '1px solid #8F3434',
                                        color: '#8F3434',
                                        fontSize: '0.75rem',
                                        textTransform: 'uppercase',
                                        fontWeight: 700,
                                        marginTop: '2rem',
                                        background: 'transparent',
                                        cursor: 'pointer'
                                    }}
                                >Logout</button>
                            </div>
                        )}

                        {activeTab === 'staff' && (
                            <div style={{ overflowY: 'auto', paddingRight: '0.5rem' }}>
                                {!isAdding ? (
                                    <button
                                        onClick={() => { setIsAdding(true); setEditForm({ id: `new-${Date.now()}`, patternOn: 5, patternOff: 2, shiftType: 'Normal', status: 'Permanent', cycleStartDate: getLocalDateString(new Date()) }); }}
                                        className="font-sans"
                                        style={{
                                            width: '100%',
                                            padding: '0.75rem',
                                            border: `1px dashed ${borderColor}`,
                                            fontSize: '0.75rem',
                                            textTransform: 'uppercase',
                                            fontWeight: 700,
                                            marginBottom: '1rem',
                                            color: textColor,
                                            background: 'transparent',
                                            cursor: 'pointer'
                                        }}
                                    >+ Add Staff</button>
                                ) : (
                                    <div style={{ background: darkMode ? 'rgba(242,239,233,0.05)' : 'rgba(18,16,14,0.05)', padding: '1rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        <input
                                            placeholder="Name"
                                            value={editForm.name || ''}
                                            onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                                            style={{ width: '100%', padding: '0.5rem', background: 'transparent', borderBottom: `1px solid ${borderColor}`, border: 'none', borderBottomWidth: '1px', borderBottomStyle: 'solid', color: textColor }}
                                        />
                                        <input
                                            placeholder="Role"
                                            value={editForm.role || ''}
                                            onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                                            style={{ width: '100%', padding: '0.5rem', background: 'transparent', borderBottom: `1px solid ${borderColor}`, border: 'none', borderBottomWidth: '1px', borderBottomStyle: 'solid', color: textColor }}
                                        />
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <input
                                                type="number"
                                                placeholder="On"
                                                value={editForm.patternOn}
                                                onChange={e => setEditForm({ ...editForm, patternOn: parseInt(e.target.value) })}
                                                style={{ width: '50%', padding: '0.5rem', background: 'transparent', borderBottom: `1px solid ${borderColor}`, border: 'none', borderBottomWidth: '1px', borderBottomStyle: 'solid', color: textColor }}
                                            />
                                            <input
                                                type="number"
                                                placeholder="Off"
                                                value={editForm.patternOff}
                                                onChange={e => setEditForm({ ...editForm, patternOff: parseInt(e.target.value) })}
                                                style={{ width: '50%', padding: '0.5rem', background: 'transparent', borderBottom: `1px solid ${borderColor}`, border: 'none', borderBottomWidth: '1px', borderBottomStyle: 'solid', color: textColor }}
                                            />
                                        </div>
                                        <input
                                            type="date"
                                            value={editForm.cycleStartDate}
                                            onChange={e => setEditForm({ ...editForm, cycleStartDate: e.target.value })}
                                            style={{ width: '100%', padding: '0.5rem', background: 'transparent', borderBottom: `1px solid ${borderColor}`, border: 'none', borderBottomWidth: '1px', borderBottomStyle: 'solid', color: textColor }}
                                        />
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <select
                                                value={editForm.status || 'Permanent'}
                                                onChange={e => setEditForm({ ...editForm, status: e.target.value as EmploymentStatus })}
                                                className="font-sans"
                                                style={{ flex: 1, padding: '0.5rem', background: darkMode ? '#2A231E' : '#F2EFE9', borderBottom: `1px solid ${borderColor}`, border: 'none', borderBottomWidth: '1px', borderBottomStyle: 'solid', color: textColor, fontSize: '0.75rem', cursor: 'pointer' }}
                                            >
                                                <option value="Permanent">Permanent</option>
                                                <option value="Casual">Casual</option>
                                            </select>
                                            <select
                                                value={editForm.shiftType || 'Normal'}
                                                onChange={e => setEditForm({ ...editForm, shiftType: e.target.value as ShiftType })}
                                                className="font-sans"
                                                style={{ flex: 1, padding: '0.5rem', background: darkMode ? '#2A231E' : '#F2EFE9', borderBottom: `1px solid ${borderColor}`, border: 'none', borderBottomWidth: '1px', borderBottomStyle: 'solid', color: textColor, fontSize: '0.75rem', cursor: 'pointer' }}
                                            >
                                                <option value="Normal">Full Shift</option>
                                                <option value="Half">Half Shift</option>
                                            </select>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem', paddingTop: '0.5rem' }}>
                                            <button
                                                onClick={handleSaveStaff}
                                                className="font-sans"
                                                style={{ flex: 1, background: textColor, color: bgColor, fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 700, padding: '0.5rem', border: 'none', cursor: 'pointer' }}
                                            >Save</button>
                                            <button
                                                onClick={() => setIsAdding(false)}
                                                className="font-sans"
                                                style={{ flex: 1, border: `1px solid ${borderColor}`, color: textColor, fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 700, padding: '0.5rem', background: 'transparent', cursor: 'pointer' }}
                                            >Cancel</button>
                                        </div>
                                    </div>
                                )}

                                {localStaff.map(s => (
                                    <div key={s.id} style={{ borderBottom: `1px solid ${darkMode ? 'rgba(242,239,233,0.1)' : 'rgba(18,16,14,0.1)'}` }}>
                                        {isEditing === s.id ? (
                                            <div style={{ background: darkMode ? 'rgba(242,239,233,0.05)' : 'rgba(18,16,14,0.05)', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                <input
                                                    placeholder="Name"
                                                    value={editForm.name || ''}
                                                    onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                                                    style={{ width: '100%', padding: '0.5rem', background: 'transparent', borderBottom: `1px solid ${borderColor}`, border: 'none', borderBottomWidth: '1px', borderBottomStyle: 'solid', color: textColor }}
                                                />
                                                <input
                                                    placeholder="Role / Position"
                                                    value={editForm.role || ''}
                                                    onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                                                    style={{ width: '100%', padding: '0.5rem', background: 'transparent', borderBottom: `1px solid ${borderColor}`, border: 'none', borderBottomWidth: '1px', borderBottomStyle: 'solid', color: textColor }}
                                                />
                                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                    <input
                                                        type="number"
                                                        placeholder="Days On"
                                                        value={editForm.patternOn}
                                                        onChange={e => setEditForm({ ...editForm, patternOn: parseInt(e.target.value) })}
                                                        style={{ width: '50%', padding: '0.5rem', background: 'transparent', borderBottom: `1px solid ${borderColor}`, border: 'none', borderBottomWidth: '1px', borderBottomStyle: 'solid', color: textColor }}
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Days Off"
                                                        value={editForm.patternOff}
                                                        onChange={e => setEditForm({ ...editForm, patternOff: parseInt(e.target.value) })}
                                                        style={{ width: '50%', padding: '0.5rem', background: 'transparent', borderBottom: `1px solid ${borderColor}`, border: 'none', borderBottomWidth: '1px', borderBottomStyle: 'solid', color: textColor }}
                                                    />
                                                </div>
                                                <input
                                                    type="date"
                                                    value={editForm.cycleStartDate}
                                                    onChange={e => setEditForm({ ...editForm, cycleStartDate: e.target.value })}
                                                    style={{ width: '100%', padding: '0.5rem', background: 'transparent', borderBottom: `1px solid ${borderColor}`, border: 'none', borderBottomWidth: '1px', borderBottomStyle: 'solid', color: textColor }}
                                                />
                                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                    <select
                                                        value={editForm.status || 'Permanent'}
                                                        onChange={e => setEditForm({ ...editForm, status: e.target.value as EmploymentStatus })}
                                                        className="font-sans"
                                                        style={{ flex: 1, padding: '0.5rem', background: darkMode ? '#2A231E' : '#F2EFE9', borderBottom: `1px solid ${borderColor}`, border: 'none', borderBottomWidth: '1px', borderBottomStyle: 'solid', color: textColor, fontSize: '0.75rem', cursor: 'pointer' }}
                                                    >
                                                        <option value="Permanent">Permanent</option>
                                                        <option value="Casual">Casual</option>
                                                    </select>
                                                    <select
                                                        value={editForm.shiftType || 'Normal'}
                                                        onChange={e => setEditForm({ ...editForm, shiftType: e.target.value as ShiftType })}
                                                        className="font-sans"
                                                        style={{ flex: 1, padding: '0.5rem', background: darkMode ? '#2A231E' : '#F2EFE9', borderBottom: `1px solid ${borderColor}`, border: 'none', borderBottomWidth: '1px', borderBottomStyle: 'solid', color: textColor, fontSize: '0.75rem', cursor: 'pointer' }}
                                                    >
                                                        <option value="Normal">Full Shift</option>
                                                        <option value="Half">Half Shift</option>
                                                    </select>
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.5rem', paddingTop: '0.5rem' }}>
                                                    <button
                                                        onClick={handleSaveStaff}
                                                        className="font-sans"
                                                        style={{ flex: 1, background: textColor, color: bgColor, fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 700, padding: '0.5rem', border: 'none', cursor: 'pointer' }}
                                                    >Save</button>
                                                    <button
                                                        onClick={() => { setIsEditing(null); setEditForm({}); }}
                                                        className="font-sans"
                                                        style={{ flex: 1, border: `1px solid ${borderColor}`, color: textColor, fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 700, padding: '0.5rem', background: 'transparent', cursor: 'pointer' }}
                                                    >Cancel</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem' }}>
                                                <div>
                                                    <div className="font-serif" style={{ fontWeight: 700, color: textColor }}>{s.name}</div>
                                                    <div style={{ fontSize: '9px', textTransform: 'uppercase', color: textColor, opacity: 0.7 }}>{s.role}</div>
                                                </div>
                                                <div style={{ display: 'flex', gap: '1rem' }}>
                                                    <button
                                                        onClick={() => { setIsEditing(s.id); setEditForm({ ...s }); }}
                                                        className="font-sans"
                                                        style={{ fontSize: '9px', textTransform: 'uppercase', color: '#4A90A4', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}
                                                    >Edit</button>
                                                    <button
                                                        onClick={() => handleDelete(s.id)}
                                                        className="font-sans"
                                                        style={{ fontSize: '9px', textTransform: 'uppercase', color: '#8F3434', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}
                                                    >Remove</button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {/* Save All Changes Button */}
                                <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: `1px solid ${darkMode ? 'rgba(242,239,233,0.2)' : 'rgba(18,16,14,0.2)'}` }}>
                                    {saveMessage && (
                                        <div style={{
                                            padding: '0.75rem',
                                            marginBottom: '0.75rem',
                                            background: saveMessage.type === 'success' ? (darkMode ? 'rgba(34,197,94,0.2)' : 'rgba(34,197,94,0.15)') : (darkMode ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)'),
                                            border: `1px solid ${saveMessage.type === 'success' ? '#22C55E' : '#EF4444'}`,
                                            color: saveMessage.type === 'success' ? '#22C55E' : '#EF4444',
                                            fontSize: '0.75rem',
                                            fontWeight: 600,
                                            textAlign: 'center'
                                        }}>
                                            {saveMessage.text}
                                        </div>
                                    )}
                                    <button
                                        onClick={handleSaveAllChanges}
                                        disabled={!hasUnsavedChanges || isSaving}
                                        className="font-sans"
                                        style={{
                                            width: '100%',
                                            padding: '1rem',
                                            background: hasUnsavedChanges ? '#22C55E' : (darkMode ? 'rgba(242,239,233,0.1)' : 'rgba(18,16,14,0.1)'),
                                            color: hasUnsavedChanges ? '#FFF' : (darkMode ? 'rgba(242,239,233,0.4)' : 'rgba(18,16,14,0.4)'),
                                            fontSize: '0.75rem',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.1em',
                                            fontWeight: 700,
                                            border: 'none',
                                            cursor: hasUnsavedChanges && !isSaving ? 'pointer' : 'not-allowed',
                                            transition: 'all 0.2s ease'
                                        }}
                                    >
                                        {isSaving ? 'Saving...' : hasUnsavedChanges ? '💾 Save All Changes to Supabase' : 'No Changes to Save'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// --- MAIN APP COMPONENT ---

const App: React.FC = () => {
    const [adminDays] = useState(30);
    const [displayMode] = useState<DisplayMode>('dots');
    const [darkMode, setDarkMode] = useState(false);
    const [isAdminOpen, setIsAdminOpen] = useState(false);
    const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);

    const { staff, updateStaffData, loading } = useRosterData();

    useEffect(() => {
        if (darkMode) document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
    }, [darkMode]);

    const daysToShow = isAdminLoggedIn ? adminDays : 30;
    const dates = useMemo(() => generateDateRange(new Date(), daysToShow), [daysToShow]);

    const handleExport = useCallback(() => {
        const headers = ['Name,Role,CycleStartDate,PatternOn,PatternOff,ShiftType,Status'];
        const rows = staff.map(s => `${s.name},${s.role},${s.cycleStartDate},${s.patternOn},${s.patternOff},${s.shiftType},${s.status}`);
        const csvContent = [headers, ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'roster-config.csv';
        link.click();
    }, [staff]);

    const handleImport = useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            const lines = text.split('\n').filter(l => l.trim().length > 0);
            const newStaff: StaffMember[] = [];
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(',');
                if (cols.length >= 7) {
                    newStaff.push({
                        id: `imported-${i}`,
                        name: cols[0],
                        role: cols[1],
                        cycleStartDate: cols[2],
                        patternOn: parseInt(cols[3]),
                        patternOff: parseInt(cols[4]),
                        shiftType: cols[5] as ShiftType,
                        status: cols[6].trim() as EmploymentStatus
                    });
                }
            }
            if (newStaff.length > 0) {
                updateStaffData(newStaff);
                alert('Import Successful');
            }
        };
        reader.readAsText(file);
    }, [updateStaffData]);

    // Note: Supabase config check removed - app will use fallback data if not configured

    return (
        <div style={{
            minHeight: '100vh',
            width: '100%',
            padding: '2rem 1rem',
            transition: 'background-color 0.5s ease-in-out',
            background: darkMode ? '#2A231E' : '#F2EFE9'
        }}>
            <div style={{ maxWidth: '100%', margin: '0 auto', paddingLeft: '2rem', paddingRight: '2rem' }}>
                <RosterHeader
                    lastUpdated={new Date()}
                    darkMode={darkMode}
                    toggleDarkMode={() => setDarkMode(!darkMode)}
                    onLoginClick={() => setIsAdminOpen(true)}
                    isAdmin={isAdminLoggedIn}
                />

                <main style={{ marginBottom: '5rem' }}>
                    {loading && staff.length === 0 ? (
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            alignItems: 'center',
                            height: '50vh',
                            gap: '1rem'
                        }}>
                            <div style={{
                                width: '2rem',
                                height: '2rem',
                                border: `2px solid ${darkMode ? 'rgba(242,239,233,0.1)' : 'rgba(18,16,14,0.1)'}`,
                                borderTopColor: darkMode ? '#F2EFE9' : '#12100E',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite'
                            }} />
                            <div className="font-serif" style={{
                                fontSize: '1.25rem',
                                color: darkMode ? '#F2EFE9' : '#12100E',
                                opacity: 0.6,
                                letterSpacing: '0.05em'
                            }}>
                                Loading Roster...
                            </div>
                            <style>{`
                                @keyframes spin {
                                    to { transform: rotate(360deg); }
                                }
                            `}</style>
                        </div>
                    ) : (
                        <RosterGrid
                            staff={staff}
                            dates={dates}
                            isAdmin={isAdminLoggedIn}
                            onUpdateStaff={updateStaffData}
                            displayMode={displayMode}
                            darkMode={darkMode}
                        />
                    )}

                    {/* Legend */}
                    <div className="font-sans" style={{
                        marginTop: '2rem',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '2rem',
                        justifyContent: 'center',
                        fontSize: '10px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                        opacity: 0.8,
                        fontWeight: 700,
                        color: darkMode ? '#F2EFE9' : '#12100E'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ width: '0.625rem', height: '0.625rem', borderRadius: '50%', background: darkMode ? '#F2EFE9' : '#12100E' }}></div>
                            <span>Normal</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ width: '0.625rem', height: '0.625rem', borderRadius: '50%', border: `2px solid ${darkMode ? '#F2EFE9' : '#12100E'}` }}></div>
                            <span>Half</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ width: '0.75rem', height: '1px', background: darkMode ? '#F2EFE9' : '#12100E' }}></span>
                            <span>Off</span>
                        </div>
                    </div>
                </main>

                <AdminModal
                    isOpen={isAdminOpen}
                    onClose={() => setIsAdminOpen(false)}
                    isLoggedIn={isAdminLoggedIn}
                    onLogin={() => setIsAdminLoggedIn(true)}
                    onLogout={() => { setIsAdminLoggedIn(false); setIsAdminOpen(false); }}
                    staffData={staff}
                    onUpdateStaff={updateStaffData}
                    onExport={handleExport}
                    onImport={handleImport}
                    darkMode={darkMode}
                />
            </div>
        </div>
    );
};

export default App;
