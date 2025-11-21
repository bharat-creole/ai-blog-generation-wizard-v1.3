# 🚀 Quick Start: Google Ads API for Keywords

## ✅ What's Integrated

The Google Ads API **automatically** fetches primary and secondary keywords when Agent Mode generates blogs. **No manual steps needed!**

---

## 📋 Setup (3 Steps)

### **Step 1: Add Environment Variables**

Create/edit `.env` file:

```bash
# Google Ads API
GOOGLE_ADS_CUSTOMER_ID=1234567890
GOOGLE_ADS_DEVELOPER_TOKEN=your_dev_token

# OAuth2 Credentials
CLIENT_ID=your_client_id.apps.googleusercontent.com
CLIENT_SECRET=your_client_secret
REFRESH_TOKEN=your_refresh_token
```

### **Step 2: Start the App**

```bash
npm run dev:full
```

This starts:
- ✅ Frontend (http://localhost:5173)
- ✅ Backend (http://localhost:3001)

### **Step 3: Use Agent Mode**

1. Go to **Agent Mode** tab
2. Enter a topic: "Write a blog about cloud computing"
3. **Automatic**: Keywords fetched from Google Ads API!

---

## 📊 Logs to Watch

### **Browser Console (F12)**
- Shows which API is being used
- Displays keyword results
- Shows fallback chain if needed

### **Server Terminal**
- Detailed API request/response
- OAuth2 token refresh status
- Error messages with solutions

---

## 🔍 Example Logs

### **✅ Success:**

```
🔍 KEYWORD RESEARCH INITIATED
   Seed: "cloud computing"
   
🎯 [PRIORITY 1] Google Ads REST API
   ✅ Successfully fetched 20 keywords
   📋 Top results:
      1. "cloud computing" - Vol: 40,500
      2. "cloud computing services" - Vol: 22,200
      3. "cloud computing solutions" - Vol: 18,100
```

### **❌ If API Fails:**

```
❌ FAILED: Google Ads REST API
   Error: Invalid credentials
   
🔄 Falling back to Bloggr AI API...
```

---

## 🎯 Where Keywords Are Used

| Stage | What Happens | API Called |
|-------|-------------|------------|
| **Primary Keyword Research** | Agent finds keyword options | ✅ Google Ads API |
| **User Selects Primary** | Chosen keyword saved | - |
| **Secondary Keyword Research** | Agent finds related keywords | ✅ Google Ads API |
| **User Selects Secondaries** | Up to 5 keywords saved | - |
| **Outline Generation** | Uses selected keywords | - |
| **Blog Generation** | Keywords optimized in content | - |

---

## 🧪 Test the Integration

```bash
# Test Google Ads API directly
npm run test:google-ads
```

This verifies:
- ✅ Credentials are correct
- ✅ OAuth2 token refresh works
- ✅ API returns keyword data

---

## 🔄 Fallback Chain

If Google Ads API fails, the system automatically tries:

```
1. Google Ads REST API ❌
   ↓
2. Bloggr AI API ❌
   ↓
3. Server API (google-ads-api library) ❌
   ↓
4. Local Simulation ✅ (Always works)
```

**Result:** App never breaks! You always get keywords.

---

## ✨ Key Features

✅ **Automatic** - No manual API calls needed  
✅ **Logged** - See exactly what's happening  
✅ **Fallbacks** - Multiple backup options  
✅ **Token Refresh** - OAuth2 handled automatically  
✅ **Real Data** - Actual search volumes from Google  

---

## 📱 Using in Agent Mode

### **Example Workflow:**

```
1. User: "Write a blog about cloud computing"
   
2. Agent: 🔍 Researching keywords...
   [Calls Google Ads API automatically]
   
3. Agent: ✅ Found 20 options:
   - cloud computing (40,500 searches/month)
   - cloud computing services (22,200)
   - ...
   
4. User: Selects "cloud computing services"
   
5. Agent: 🔍 Finding secondary keywords...
   [Calls Google Ads API automatically]
   
6. Agent: ✅ Found 18 related keywords
   
7. User: Selects 5 secondary keywords
   
8. Agent: 📝 Generating outline...
   [Continues blog generation]
```

**All keyword fetching is automatic and logged!**

---

## 🆘 Troubleshooting

| Issue | Solution |
|-------|----------|
| No keywords returned | Check `.env` credentials |
| "Token refresh failed" | Generate new refresh token |
| "Missing credentials" | Add all required env vars |
| Slow API response | Normal (Google Ads API can take 1-2s) |

---

## 📚 Full Documentation

See `GOOGLE_ADS_INTEGRATION.md` for:
- Detailed logging examples
- Complete error messages
- Advanced configuration
- API response structure

---

**Ready to go!** Just start the app with `npm run dev:full` and use Agent Mode. Keywords will automatically be fetched from Google Ads API! 🎉


