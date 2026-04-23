const express = require("express");
const bodyParser = require("body-parser");
const sha512 = require("js-sha512");
const axios = require("axios");
const cors = require("cors");
const qs = require("qs");
const Airtable = require("airtable");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cors());

/* =========================================
   🔐 EASEBUZZ CONFIG
========================================= */
const config = {
    key: "PU5U8NI7O2",
    salt: "4QHTXHY9HP",
    env: "prod", // "test" or "prod"
};

/* =========================================
   📊 AIRTABLE CONFIG
========================================= */
const AIRTABLE_API_KEY = "patNO8vCm7vWoQ9gx.cb296541f27a023e1aa17b67e9adfb7e31e0199be521ed7db0484a8a17796d6f";
const AIRTABLE_BASE_ID = "appQwYV1wEzK1hfWz";
const AIRTABLE_TABLE_NAME = "tbl9sWfgAwYrP3mCf";

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

/* =========================================
   🌐 EASEBUZZ URL
========================================= */
function getEasebuzzUrl(env) {
    return env === "prod"
        ? "https://pay.easebuzz.in/"
        : "https://testpay.easebuzz.in/";
}

/* =========================================
   🔐 CORRECT HASH FUNCTION (FIXED)
========================================= */
function generateHash(data) {
    const amount = parseFloat(data.amount).toFixed(2);

    const hashString =
        config.key +
        "|" +
        data.txnid +
        "|" +
        amount +
        "|" +
        data.productinfo +
        "|" +
        data.name +
        "|" +
        data.email +
        "|" +
        (data.udf1 || '') +
        "|" +
        (data.udf2 || '') +
        "|" +
        (data.udf3 || '') +
        "|" +
        (data.udf4 || '') +
        "|||||||" + // udf5 to udf10 are empty
        config.salt;

    console.log("HASH STRING:", hashString);

    return sha512.sha512(hashString);
}

/* =========================================
   💳 PAYMENT API (MAIN)
========================================= */
app.post("/api/payment", async (req, res) => {
    try {
        const data = req.body;

        // ✅ sanitize inputs
        data.name = data.name?.trim() || "";
        data.email = data.email?.trim() || "";
        data.productinfo = data.productinfo?.trim() || "";
        data.amount = parseFloat(data.amount).toFixed(2);

        const hash = generateHash(data);

        const form = {
            key: config.key,
            txnid: data.txnid,
            amount: data.amount,
            firstname: data.name,
            email: data.email,
            phone: data.phone,
            productinfo: data.productinfo,

            // 🔁 CALLBACK URLs
            surl:
                "https://easebuzz-backend.onrender.com/api/easebuzz/success",
            furl:
                "https://easebuzz-backend.onrender.com/api/easebuzz/failure",

            // Pass along user-defined fields
            udf1: data.udf1 || '',
            udf2: data.udf2 || '',
            udf3: data.udf3 || '',
            udf4: data.udf4 || '',

            hash: hash,
        };

        console.log("FINAL FORM:", form);

        const response = await axios.post(
            getEasebuzzUrl(config.env) + "payment/initiateLink",
            qs.stringify(form),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            }
        );

        const result = response.data;

        console.log("Easebuzz Response:", result);

        if (result?.status === 1) {
            return res.json({
                status: 1,
                access_key: result.data, // 🔥 IMPORTANT
                key: config.key,
            });
        } else {
            return res.status(400).json({
                status: 0,
                error: "Failed to generate payment link",
                details: result,
            });
        }
    } catch (error) {
        console.error("❌ ERROR:", error?.response?.data || error.message);

        res.status(500).json({
            status: 0,
            error: "Internal Server Error",
            details: error?.response?.data || error.message,
        });
    }
});

/* =========================================
   ✅ PAYMENT SUCCESS
========================================= */
app.post("/api/easebuzz/success", async (req, res) => {
    console.log("✅ SUCCESS:", req.body);

    const { txnid } = req.body;

    if (!txnid) return res.status(400).send("Missing txnid");

    try {
        // ✅ 2. Update Airtable booking flag
        const records = await base(AIRTABLE_TABLE_NAME)
            .select({ filterByFormula: `{Transaction ID}='${txnid}'` })
            .firstPage();

        if (records.length > 0) {
            await base(AIRTABLE_TABLE_NAME).update(records[0].id, {
                "Status": "Paid",
            });
        }

        // Redirect to frontend success page
        const frontendUrl = `https://anandtirumaladevasthanam.com/payment-status.html?status=success&txnid=${encodeURIComponent(txnid)}`;
        return res.redirect(frontendUrl);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating Airtable");
    }
});

/* =========================================
   ❌ PAYMENT FAILURE
========================================= */
app.post("/api/easebuzz/failure", async (req, res) => {
    console.log("❌ FAILURE:", req.body);

    const { txnid } = req.body;

    if (!txnid) return res.status(400).send("Missing txnid");

    try {
        // ✅ 2. Mark Airtable as Failed
        const records = await base(AIRTABLE_TABLE_NAME)
            .select({ filterByFormula: `{Transaction ID}='${txnid}'` })
            .firstPage();

        if (records.length > 0) {
            await base(AIRTABLE_TABLE_NAME).update(records[0].id, {
                "Status": "Failed",
            });
        }

        // Redirect to frontend failure page
        const frontendUrl = `https://anandtirumaladevasthanam.com/payment-status.html?status=failed&txnid=${encodeURIComponent(txnid)}`;
        return res.redirect(frontendUrl);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating Airtable");
    }
});

/* =========================================
   🔍 VERIFY PAYMENT
========================================= */
app.post("/api/verify-payment", async (req, res) => {
    const { txnid } = req.body;

    if (!txnid) {
        return res.status(400).json({ status: "error", message: "txnid required" });
    }

    try {
        const records = await base(AIRTABLE_TABLE_NAME)
            .select({ filterByFormula: `{txnid}='${txnid}'` })
            .firstPage();

        if (records.length > 0) {
            return res.json({ status: "success", data: records[0].fields });
        } else {
            return res.json({ status: "failed" });
        }
    } catch (err) {
        res.status(500).json({ status: "error" });
    }
});

/* =========================================
   🚀 SERVER START
========================================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
}); 