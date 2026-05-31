require('dotenv').config();
const mongoose = require('mongoose');

const userStatsSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    starredWords: { type: [String], default: [] }
});

const UserStats = mongoose.model('UserStatsTest', userStatsSchema);

async function test() {
    await mongoose.connect('mongodb://localhost:27017/gre-test');
    const id = new mongoose.Types.ObjectId();
    
    console.log("Upserting with aberrant...");
    await UserStats.findOneAndUpdate(
        { userId: id },
        { $set: { starredWords: ["aberrant"] } },
        { upsert: true, new: true }
    );
    
    let doc = await UserStats.findOne({ userId: id }).lean();
    console.log("Doc after upsert:", doc.starredWords);
    
    console.log("Upserting with empty array...");
    await UserStats.findOneAndUpdate(
        { userId: id },
        { $set: { starredWords: [] } },
        { upsert: true, new: true }
    );
    
    doc = await UserStats.findOne({ userId: id }).lean();
    console.log("Doc after empty array:", doc.starredWords);
    
    await mongoose.disconnect();
}

test().catch(console.error);
