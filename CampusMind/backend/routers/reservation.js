import { Router } from 'express';
import { Reservation } from '../models/reservationModel.js';
import { User } from '../models/userModel.js';
import { Sport } from '../models/sportModel.js';
import { Court } from '../models/courtModel.js';
import jwt from 'jsonwebtoken';
import { auth } from '../middleware/middleware.js'; // Ensure the auth middleware is imported from middleware.js
import mongoose from 'mongoose';
import moment from 'moment-timezone';

const router = Router();
router.use(auth);

router.post('/createReservation', auth, async (req, res) => {
    try {
        const { sportName, courtName, date, time } = req.body;
        console.log("Received data:", sportName, courtName, date, time);

        // Verify if the user exists in the database
        const user = await User.findById(req.user._id);
        if (!user) {
            console.log("Unauthorized access attempt: User not found");
            return res.status(403).json({ error: "Unauthorized access. User not found in the system." });
        }

        const sport = await Sport.findOne({ sport_name: sportName });
        // console.log("1. Sport found:", sport);
        if (!sport) {
            console.log("Error: Sport not found.");
            return res.status(404).json({ error: "Sport not found." });
        }

        // Find the court by name and sport_id
        const court = await Court.findOne({ court_name: courtName, sport_id: sport._id });
        if (!court) {
            console.log("Error: Court not found for this sport.");
            return res.status(404).json({ error: "Court not found for this sport." });
        }

        // Check if the court is available
        if (!court.is_available) {
            console.log("Error: Court is currently unavailable.");
            return res.status(400).json({ error: "Court is currently unavailable." });
        }

        // Validate required fields
        if (!sportName || !courtName || !date || !time) {
            console.log("Error: All fields (sportName, courtName, date, time) are required.");
            return res.status(400).json({ error: "All fields (sportName, courtName, date, time) are required." });
        }

        // Additional validation (e.g., date format, time format)
        if (isNaN(Date.parse(date))) {
            console.log("Error: Invalid date format.");
            return res.status(400).json({ error: "Invalid date format." });
        }

        // console.log("4. Date parsed successfully:", date);
        // console.log("5. Time received:", time);

        // Parse the time range (e.g., "1:30 PM - 2:30 PM")
        const timeRegex = /^(\d{1,2}:\d{2}\s?[APMapm]{2})\s*-\s*(\d{1,2}:\d{2}\s?[APMapm]{2})$/;
        const match = time.match(timeRegex);

        if (!match) {
            console.log("Error: Invalid time format. Expected format is 'HH:MM AM/PM - HH:MM AM/PM'.");
            return res.status(400).json({ error: "Invalid time format. Expected format is 'HH:MM AM/PM - HH:MM AM/PM'." });
        }

        const [_, startTime, endTime] = match;

        // Convert start and end times to 24-hour format (HH:MM)
        const startTime24 = moment(startTime, ["h:mm A"]).format("HH:mm");
        const endTime24 = moment(endTime, ["h:mm A"]).format("HH:mm");

        console.log("Start time (24-hour format):", startTime24);
        console.log("End time (24-hour format):", endTime24);

        // Define the Central Time (CT) time zone
        const centralTimeZone = 'America/Chicago';

        // Convert today's date to Central Time
        const today = moment.tz(new Date(), centralTimeZone).startOf('day');
        console.log("Today's date (CT):", today.format());

        // Combine reservation date and start time into a single datetime
        const reservationDateTime = moment.tz(`${date} ${startTime24}`, 'YYYY-MM-DD HH:mm', centralTimeZone);
        console.log("Reservation date and time (CT):", reservationDateTime.format());

        // Compare reservation date with today's date
        if (reservationDateTime.isBefore(today)) {
            console.log("Error: Reservation date must be in the future.");
            return res.status(400).json({ error: "Reservation date must be in the future." });
        }
        
       // console.log("6. Is revervation date after today:", reservationDateTime.isAfter(today));
        
        const existingReservation = await Reservation.findOne({ 
            user_id: req.user._id,
            sport_id: sport._id,
            court_id: court._id,
            date,
            start_time: startTime24,
            end_time: endTime24, 
        });

        if (existingReservation) {
            console.log("Error: You already have a reservation for this game on this date and time.");
            return res.status(400).json({ error: "You already have a reservation for this game on this date and time." });
        }

        // Check for conflicting reservations for the same court
        const conflictingReservation = await Reservation.findOne({
            court_id: court._id,
            date,
            $or: [
                { start_time: { $lt: endTime24 }, end_time: { $gt: startTime24 } }, // Overlaps with existing reservation
            ],
        });

        if (conflictingReservation) {
            console.log("Error: Time conflict with an existing reservation for this court.");
            return res.status(400).json({ error: "Time conflict with an existing reservation for this court." });
        }

        const reservation = new Reservation({ 
            user_id: req.user._id, 
            sport_id: sport._id,
            court_id: court._id,
            date, 
            start_time: startTime24,
            end_time: endTime24,
        });

        await reservation.save();

        console.log("Reservation added successfully!");
        return res.status(201).json({ message: "Reservation added successfully!" });
    } catch (error) {
        console.error("Error adding reservation:", error.message);
        return res.status(500).json({ error: "Internal server error. Please try again later." });
    }
});

router.get('/getUserReservation', auth, async (req, res) => {
    try {
        const userId = req.user._id;

        // Fetch reservations for the user
        const reservations = await Reservation.find({ user_id: userId })
            .populate('sport_id')
            .populate('court_id');

        // Format start_time and end_time into "H:MM AM/PM - H:MM AM/PM"
        const formattedReservations = reservations.map((reservation) => ({
            _id: reservation._id,
            sportName: reservation.sport_id.sport_name,
            courtName: reservation.court_id.court_name,
            date: reservation.date,
            time: `${moment(reservation.start_time, 'HH:mm').format('h:mm A')} - ${moment(reservation.end_time, 'HH:mm').format('h:mm A')}`,
        }));

        res.status(200).json(formattedReservations);
    } catch (error) {
        console.error('Error fetching reservations:', error.message);
        res.status(500).json({ error: 'An error occurred while fetching reservations.' });
    }
});

router.delete('/cancelReservation/:reservationId', auth, async (req, res) => {
    const { reservationId } = req.params; // Extract reservationId from the URL
    const userId = req.user._id; // Get the authenticated user's ID from the token

    console.log(`User ${userId} is attempting to delete reservation ${reservationId}`);

    try {
        // Validate the reservationId
        if (!mongoose.Types.ObjectId.isValid(reservationId)) {
            return res.status(400).json({ error: 'The provided reservation ID is invalid.' });
        }

        // Find the reservation by ID
        const reservation = await Reservation.findById(reservationId);

        if (!reservation) {
            return res.status(404).json({ error: 'Reservation not found' });
        }

        // Check if the user is authorized to delete this reservation
        if (reservation.user_id.toString() !== userId.toString()) {
            return res.status(403).json({ error: 'You are not authorized to delete this reservation' });
        }

        // Delete the reservation
        await reservation.deleteOne();

        console.log(`Reservation ${reservationId} deleted successfully`);
        res.status(200).json({ message: 'Reservation deleted successfully' });
    } catch (error) {
        console.error('Error deleting reservation:', error.message);
        res.status(500).json({ error: 'An error occurred while deleting the reservation' });
    }
});

router.put('/modifyReservation/:reservationId', auth, async (req, res) => {
    const { reservationId } = req.params;
    const { sportName, date, time } = req.body;
    const userId = req.user._id;

    try {
        // Validate required fields
        if (!sportName || !date || !time) {
            return res.status(400).json({ error: 'All fields (sportName, date, time) are required.' });
        }

        // Verify if the user exists in the database
        const user = await User.findById(userId);
        if (!user) {
            console.log("Unauthorized access attempt: User not found");
            return res.status(403).json({ error: "Unauthorized access. User not found in the system." });
        }

        const sport = await Sport.findOne({ sport_name: sportName });
        if (!sport) {
            return res.status(404).json({ error: 'Sport not found' });
        }

        const reservation = await Reservation.findById(reservationId);
        if (!reservation) {
            return res.status(404).json({ error: 'Reservation not found' });
        }

        if (reservation.user_id.toString() !== userId.toString()) {
            return res.status(403).json({ error: 'You are not authorized to modify this reservation.' });
        }

        // Additional validation (e.g., date format)
        if (isNaN(Date.parse(date))) {
            return res.status(400).json({ error: 'Invalid date format.' });
        }

        // Parse the time range (e.g., "1:30 PM - 2:30 PM")
        const timeRegex = /^(\d{1,2}:\d{2}\s?[APMapm]{2})\s*-\s*(\d{1,2}:\d{2}\s?[APMapm]{2})$/;
        const match = time.match(timeRegex);

        if (!match) {
            return res.status(400).json({ error: "Invalid time format. Expected format is 'HH:MM AM/PM - HH:MM AM/PM'." });
        }

        const [_, startTime, endTime] = match;

        // Convert start and end times to 24-hour format (HH:MM)
        const startTime24 = moment(startTime, ["h:mm A"]).format("HH:mm");
        const endTime24 = moment(endTime, ["h:mm A"]).format("HH:mm");

        // Check for conflicting reservations
        const conflictingReservation = await Reservation.findOne({
            sport_id: sport._id,
            date,
            _id: { $ne: reservationId }, // Exclude the current reservation
            $or: [
                { start_time: { $lt: endTime24 }, end_time: { $gt: startTime24 } }, // Overlaps with existing reservation
            ],
        });

        if (conflictingReservation) {
            return res.status(400).json({ error: "Time conflict with an existing reservation for the same sport." });
        }

        // Update the reservation
        reservation.sport_id = sport._id;
        reservation.date = date;
        reservation.start_time = startTime24;
        reservation.end_time = endTime24;

        await reservation.save();

        res.status(200).json({ message: 'Reservation updated successfully', reservation });
    } catch (error) {
        console.error('Error updating reservation:', error.message);
        res.status(500).json({ error: 'An error occurred while updating the reservation' });
    }
});

router.get('/getAvailableCourts/:sportName', auth, async (req, res) => {
    try {
        const { sportName } = req.params;
        console.log('Fetching courts for sport:', sportName);

        // Find the sport by name
        const sport = await Sport.findOne({ sport_name: sportName });
        if (!sport) {
            console.log('Sport not found:', sportName);
            return res.status(404).json({ error: 'Sport not found' });
        }
        console.log('Found sport:', sport);

        // Find all available courts for this sport
        const courts = await Court.find({ 
            sport_id: sport._id,
            is_available: true 
        }).select('court_name is_shared shared_with');

        console.log('Found courts:', courts);
        res.status(200).json(courts);
    } catch (error) {
        console.error('Error in getAvailableCourts:', error);
        res.status(500).json({ error: 'An error occurred while fetching available courts', details: error.message });
    }
});

router.get('/checkCourtAvailability', auth, async (req, res) => {
    try {
        const { sportName, date, startTime, endTime } = req.query;
        
        if (!sportName || !date || !startTime || !endTime) {
            return res.status(400).json({ error: "All parameters (sportName, date, startTime, endTime) are required." });
        }
        
        // Find the sport by name
        const sport = await Sport.findOne({ sport_name: sportName });
        if (!sport) {
            return res.status(404).json({ error: "Sport not found." });
        }
        
        // Find all courts for this sport
        const courts = await Court.find({ sport_id: sport._id });
        
        // Get all reservations for these courts on the specified date
        const reservations = await Reservation.find({
            court_id: { $in: courts.map(court => court._id) },
            date: date,
            $or: [
                { start_time: { $lt: endTime }, end_time: { $gt: startTime } }
            ]
        });
        
        // Create a map of court IDs to their reservations
        const courtReservations = {};
        reservations.forEach(reservation => {
            if (!courtReservations[reservation.court_id]) {
                courtReservations[reservation.court_id] = [];
            }
            courtReservations[reservation.court_id].push(reservation);
        });
        
        // Filter out courts that are already reserved
        const availableCourts = courts.filter(court => {
            // If the court has no reservations, it's available
            if (!courtReservations[court._id]) {
                return true;
            }
            
            // Check if any reservation overlaps with the requested time
            return !courtReservations[court._id].some(reservation => {
                return (
                    (reservation.start_time < endTime && reservation.end_time > startTime)
                );
            });
        });
        
        // Format the response
        const formattedCourts = availableCourts.map(court => ({
            _id: court._id,
            court_name: court.court_name,
            is_shared: court.is_shared,
            shared_with: court.shared_with
        }));
        
        res.status(200).json(formattedCourts);
    } catch (error) {
        console.error('Error checking court availability:', error.message);
        res.status(500).json({ error: 'An error occurred while checking court availability.' });
    }
});

export default router;
