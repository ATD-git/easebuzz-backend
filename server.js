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

// ✅ Easebuzz Config
const config = {
    key: "PU5U8NI7O2",
    salt: "4QHTXHY9HP",
    env: "prod",
};

// ✅ Airtable Config
const AIRTABLE_API_KEY = "patNO8vCm7vWoQ9gx.cb296541f27a023e1aa17b67e9adfb7e31e0199be521ed7db0484a8a17796d6f";
const AIRTABLE_BASE_ID = "appQwYV1wEzK1hfWz";
const AIRTABLE_TABLE_NAME = "tbl9sWfgAwYrP3mCf";

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

// ✅ Utility: Get Easebuzz base URL
function getEasebuzzUrl(env) {
    return env === "prod" ? "https://pay.easebuzz.in/" : "https://testpay.easebuzz.in/";
}

// ✅ Generate Hash
function generateHash(data) {
    const hashString =
        config.key + "|" +
        data.txnid + "|" +
        data.amount + "|" +
        data.productinfo + "|" +
        data.name + "|" +
        data.email + "|" +
        (data.udf1 || "") + "|" +
        (data.udf2 || "") + "|" +
        (data.udf3 || "") + "|" +
        (data.udf4 || "") + "|" +
        (data.udf5 || "") + "|" +
        (data.udf6 || "") + "|" +
        (data.udf7 || "") + "|" +
        (data.udf8 || "") + "|" +
        (data.udf9 || "") + "|" +
        (data.udf10 || "") + "|" +
        config.salt;

    return sha512.sha512(hashString);
}

// ✅ Payment Link API
app.post("/api/payment", async (req, res) => {
    try {
        const data = req.body;
        data.name = data.name?.trim() || "";
        data.email = data.email?.trim() || "";
        data.productinfo = data.productinfo?.trim() || "";

        const hash = generateHash(data);

        const form = {
            key: config.key,
            txnid: data.txnid,
            amount: data.amount,
            firstname: data.name,
            email: data.email,
            phone: data.phone,
            productinfo: data.productinfo,
            surl: "https://easebuzz-backend.onrender.com/api/easebuzz/success",
            furl: "https://easebuzz-backend.onrender.com/api/easebuzz/failure",
            hash,
        };

        const response = await axios.post(
            getEasebuzzUrl(config.env) + "payment/initiateLink",
            qs.stringify(form),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        const result = response.data;
        if (result?.status === 1 && typeof result.data === "string") {
            const accessKey = result.data;
            const paymentUrl = getEasebuzzUrl(config.env) + "pay/" + accessKey;
            res.json({ status: 1, url: paymentUrl });
        } else if (result?.status === 1 && result?.data?.payment_link) {
            res.json({ status: 1, url: result.data.payment_link });
        } else {
            res.status(500).json({ status: 0, error: "Failed to generate payment link", details: result });
        }
    } catch (error) {
        console.error("❌ Internal Error:", error?.response?.data || error.message);
        res.status(500).json({ status: 0, error: "Internal Server Error" });
    }
});

// ✅ Payment Success
app.post("/api/easebuzz/success", async (req, res) => {
    console.log("✅ Payment Success Callback:", req.body);

    const txnid = req.body.txnid;
    if (!txnid) return res.status(400).send("Missing txnid");

    try {
        const records = await base(AIRTABLE_TABLE_NAME)
            .select({ filterByFormula: `{txnid} = '${txnid}'` })
            .firstPage();

        if (records.length > 0) {
            const recordId = records[0].id;
            await base(AIRTABLE_TABLE_NAME).update(recordId, {
                "Payment Status": "Success",
            });
            console.log(`✅ Updated to Success for txnid ${txnid}`);
        } else {
            console.log(`⚠️ No record found for txnid: ${txnid}`);
        }

        // ✅ FIX: Use backticks so txnid interpolates correctly
        return res.redirect(`https://anandatirumaladevasthanam.com/payment-status.html?status=success&txnid=${encodeURIComponent(txnid)}`);
    } catch (error) {
        console.error("❌ Error updating Airtable:", error);
        res.status(500).send("Error updating Airtable record");
    }
});

// ✅ Payment Failure
app.post("/api/easebuzz/failure", async (req, res) => {
    console.log("❌ Payment Failed Callback:", req.body);

    const txnid = req.body.txnid;
    if (!txnid) return res.status(400).send("Missing txnid");

    try {
        const records = await base(AIRTABLE_TABLE_NAME)
            .select({ filterByFormula: `{txnid} = '${txnid}'` })
            .firstPage();

        if (records.length > 0) {
            const recordId = records[0].id;
            await base(AIRTABLE_TABLE_NAME).update(recordId, {
                "Payment Status": "Failed",
            });
            console.log(`❌ Updated to Failed for txnid ${txnid}`);
        } else {
            console.log(`⚠️ No record found for txnid: ${txnid}`);
        }

        // ✅ FIX: Use backticks so txnid interpolates correctly
        return res.redirect(`https://anandatirumaladevasthanam.com/payment-status.html?status=failed&txnid=${encodeURIComponent(txnid)}`);
    } catch (error) {
        console.error("❌ Error updating failure status:", error);
        res.status(500).send("Error updating Airtable record");
    }
});

// ✅ Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));