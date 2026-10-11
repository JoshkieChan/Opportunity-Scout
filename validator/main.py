from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from validator.models import Product, ValidationResult
from validator.scoring import evaluate

app = FastAPI(title="Opportunity Scout", version="1.0.0")


@app.exception_handler(RequestValidationError)
async def invalid_request(_request, exc: RequestValidationError) -> JSONResponse:
    # Do not echo untrusted inputs, credentials, or non-JSON numeric values.
    fields = set(Product.model_fields)
    detail = []
    for error in exc.errors():
        location = [part if part == "body" or part in fields else "field"
                    for part in error["loc"]]
        detail.append({"loc": location, "msg": error["msg"], "type": error["type"]})
    return JSONResponse(status_code=422, content={"detail": detail})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/validate", response_model=ValidationResult)
def validate_product(product: Product) -> ValidationResult:
    return evaluate(product)
