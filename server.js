const express = require("express");
const bodyParser = require("body-parser");
const sha512Module = require("js-sha512");
const axios = require("axios");
const cors = require("cors");
const qs = require("qs");
const Airtable = require("airtable");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cors());

// ─── FIX 1: Safely extract sha512 function regardless of how the package exports ───
const sha512 =
    typeof sha512Module === "function"
        ? sha512Module
        : sha512Module.sha512 || sha512Module.default;

// ✅ Easebuzz Config
const config = {
    key: "PU5U8NI7O2",
    salt: "4QHTXHY9HP",
    env: "prod",
};

// ✅ Airtable Config
const AIRTABLE_API_KEY =
    "patNO8vCm7vWoQ9gx.cb296541f27a023e1aa17b67e9adfb7e31e0199be521ed7db0484a8a17796d6f";
const AIRTABLE_BASE_ID = "appQwYV1wEzK1hfWz";
const AIRTABLE_TABLE_NAME = "tbl9sWfgAwYrP3mCf";

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

// ─── Utility: Get Easebuzz base URL ───
function getEasebuzzUrl(env) {
    return env === "prod"
        ? "https://pay.easebuzz.in/"
        : "https://testpay.easebuzz.in/";
}

// ─── FIX 2: Correct hash generation per Easebuzz docs ───
// Format: key|txnid|amount|productinfo|firstname|email|udf1..udf10|salt
function generateHash(data) {
    const hashString = [
        config.key,
        data.txnid,
        data.amount,          // Must be "100.00" format
        data.productinfo,
        data.firstname,       // FIX: use firstname (not name)
        data.email,
        data.udf1 || "",
        data.udf2 || "",
        data.udf3 || "",
        data.udf4 || "",
        data.udf5 || "",
        data.udf6 || "",
        data.udf7 || "",
        data.udf8 || "",
        data.udf9 || "",
        data.udf10 || "",
        config.salt,
    ].join("|");

    console.log("🔑 Hash Input String:", hashString);
    return sha512(hashString);
}

// ─── FIX 3: Input validation helper ───
function validatePaymentData(data) {
    const required = ["txnid", "amount", "productinfo", "firstname", "email", "phone"];
    const missing = required.filter((f) => !data[f] || String(data[f]).trim() === "");
    return missing;
}

// ✅ Payment Initiation API
app.post("/api/payment", async (req, res) => {
    try {
        console.log("📥 Incoming payment request:", req.body);

        // ─── Normalize fields: accept both 'name' and 'firstname' from frontend ───
        const data = { ...req.body };
        if (!data.firstname && data.name) {
            data.firstname = data.name.trim();
        }
        data.firstname = (data.firstname || "").trim();
        data.email = (data.email || "").trim();
        data.productinfo = (data.productinfo || "").trim();

        // ─── FIX 4: Format amount to 2 decimal places ───
        if (data.amount) {
            data.amount = parseFloat(data.amount).toFixed(2);
        }

        // ─── Validate required fields ───
        const missing = validatePaymentData(data);
        if (missing.length > 0) {
            console.error("❌ Missing fields:", missing);
            return res.status(400).json({
                status: 0,
                error: `Missing required fields: ${missing.join(", ")}`,
            });
        }

        const hash = generateHash(data);
        console.log("🔑 Generated Hash:", hash);

        const form = {
            key: config.key,
            txnid: data.txnid,
            amount: data.amount,
            firstname: data.firstname,
            email: data.email,
            phone: data.phone,
            productinfo: data.productinfo,
            surl: "https://easebuzz-backend.onrender.com/api/easebuzz/success",
            furl: "https://easebuzz-backend.onrender.com/api/easebuzz/failure",
            hash,
            udf1: data.udf1 || "",
            udf2: data.udf2 || "",
            udf3: data.udf3 || "",
            udf4: data.udf4 || "",
            udf5: data.udf5 || "",
        };

        console.log("📤 Sending to Easebuzz:", form);

        const response = await axios.post(
            getEasebuzzUrl(config.env) + "payment/initiateLink",
            qs.stringify(form),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        console.log("📩 Easebuzz raw response:", response.data);

        const result = response.data;

        if (result?.status === 1 && typeof result.data === "string") {
            const accessKey = result.data;
            const paymentUrl = getEasebuzzUrl(config.env) + "pay/" + accessKey;
            console.log("✅ Payment URL:", paymentUrl);
            return res.json({ status: 1, url: paymentUrl });
        } else if (result?.status === 1 && result?.data?.payment_link) {
            return res.json({ status: 1, url: result.data.payment_link });
        } else {
            // ─── FIX 5: Return Easebuzz error details to help debug ───
            console.error("❌ Easebuzz rejected the request:", result);
            return res.status(500).json({
                status: 0,
                error: "Easebuzz rejected the payment initiation",
                easebuzz_response: result,  // shows exact reason from Easebuzz
            });
        }
    } catch (error) {
        const errDetail = error?.response?.data || error.message;
        console.error("❌ Internal Error:", errDetail);
        return res.status(500).json({
            status: 0,
            error: "Internal Server Error",
            detail: errDetail,
        });
    }
});