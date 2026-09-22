"""Bounded HTTP observations against one manager-measured laboratory address."""
import http.client
import json
import sys
from urllib.parse import urlsplit

request = json.load(sys.stdin)
origin = urlsplit(request["origin"])
connection = http.client.HTTPConnection(request["address"], origin.port or 80, timeout=request["timeout"])
result = {"responses": [], "incomplete": False, "cleanup": "connection closed"}
try:
    connection.request(request["method"], request["path"], headers={"Host": origin.netloc, "User-Agent": "DSH-laboratory/1"})
    response = connection.getresponse()
    body = response.read(request["maxBytes"] + 1)
    result["incomplete"] = len(body) > request["maxBytes"]
    result["responses"].append({"path": request["path"], "status": response.status,
        "headers": response.getheaders(), "body": body[:request["maxBytes"]].decode("utf-8", "replace")})
except Exception as error:
    result["incomplete"] = True
    result["failure"] = str(error)
finally:
    connection.close()
print(json.dumps(result))
